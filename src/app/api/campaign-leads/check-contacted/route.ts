// TODO(ROGA-49): usar getCurrentWorkspaceId() de "@/lib/server/workspace"
//   antes de filtrar/inserir em tabelas multi-tenant. Aguarda Fase 2
//   (FK workspace_id) + Fase 3 (RLS) para migrar de forma segura.
//   Ver ROGA-74 para o helper.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { markAlreadyContacted } from "@/lib/server/campaign-leads";

/**
 * Para cada lead, consulta message_dispatch_history e marca já_contactado
 * se houver registro de status='sent' dentro da janela.
 * Body: { ids?: string[], windowDays?: number }  (ids omitido = todos da campanha)
 */
export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { ids, windowDays } = (body ?? {}) as {
    ids?: unknown;
    windowDays?: unknown;
  };

  const days =
    typeof windowDays === "number" && Number.isFinite(windowDays) && windowDays > 0
      ? Math.min(windowDays, 365)
      : 30;

  // Carrega os leads a checar (ids específicos, ou todos da campanha default).
  let query = supabaseAdmin
    .from("campaign_leads")
    .select("id, phone_normalized");

  if (Array.isArray(ids) && ids.length > 0) {
    query = query.in("id", ids as string[]);
  }

  const { data: leads, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (leads ?? []) as { id: string; phone_normalized: string }[];
  if (rows.length === 0) {
    return NextResponse.json({ success: true, contacted: 0, notContacted: 0 });
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Pega telefones únicos para 1 query só.
  const uniquePhones = Array.from(new Set(rows.map((r) => r.phone_normalized)));

  // Histórico usa contact_phone (pode ter formatação) — comparar por contains via match dos últimos dígitos.
  // Estratégia: buscar tudo desde `since` e dar match por substring/normalização em memória.
  const { data: history, error: histErr } = await supabaseAdmin
    .from("message_dispatch_history")
    .select("contact_phone, created_at, status")
    .gte("created_at", since)
    .eq("status", "sent");

  if (histErr) {
    return NextResponse.json({ error: histErr.message }, { status: 500 });
  }

  const contactedByPhone = new Map<string, string>(); // phone_norm -> last_at
  for (const h of history ?? []) {
    const norm = (h.contact_phone ?? "").replace(/\D/g, "");
    if (!norm) continue;
    // tolerância: bate se o normalizado bate exatamente OU se um termina com o outro
    for (const p of uniquePhones) {
      if (norm === p || norm.endsWith(p) || p.endsWith(norm)) {
        const prev = contactedByPhone.get(p);
        if (!prev || prev < h.created_at) {
          contactedByPhone.set(p, h.created_at);
        }
      }
    }
  }

  const contactedIds: string[] = [];
  const notContactedIds: string[] = [];
  let lastAtSample: string | null = null;
  for (const r of rows) {
    if (contactedByPhone.has(r.phone_normalized)) {
      contactedIds.push(r.id);
      lastAtSample = contactedByPhone.get(r.phone_normalized) ?? null;
    } else {
      notContactedIds.push(r.id);
    }
  }

  try {
    if (contactedIds.length > 0) {
      await markAlreadyContacted(contactedIds, lastAtSample, true);
    }
    if (notContactedIds.length > 0) {
      await markAlreadyContacted(notContactedIds, null, false);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao salvar verificação";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    contacted: contactedIds.length,
    notContacted: notContactedIds.length,
    windowDays: days,
  });
}