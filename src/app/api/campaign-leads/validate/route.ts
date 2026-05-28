// TODO(ROGA-49): usar getCurrentWorkspaceId() de "@/lib/server/workspace"
//   antes de filtrar/inserir em tabelas multi-tenant. Aguarda Fase 2
//   (FK workspace_id) + Fase 3 (RLS) para migrar de forma segura.
//   Ver ROGA-74 para o helper.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getSocket } from "@/lib/whatsapp-manager";
import { toJid } from "@/lib/phone";
import { markValidWhatsApp } from "@/lib/server/campaign-leads";

const BATCH_SIZE = 50;

/**
 * Valida via Baileys onWhatsApp() se cada lead tem WhatsApp ativo.
 * Body: { ids: string[], accountId: string }
 * Atualiza valid_whatsapp em campaign_leads.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { ids, accountId } = (body ?? {}) as { ids?: unknown; accountId?: unknown };

  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "ids deve ser array de string" }, { status: 400 });
  }
  if (typeof accountId !== "string" || accountId.trim() === "") {
    return NextResponse.json({ error: "accountId é obrigatório" }, { status: 400 });
  }

  const sock = getSocket(accountId);
  if (!sock || typeof sock.onWhatsApp !== "function") {
    return NextResponse.json(
      { error: "Conta WhatsApp não está conectada ou não suporta validação" },
      { status: 503 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("campaign_leads")
    .select("id, phone_normalized")
    .in("id", ids as string[]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as { id: string; phone_normalized: string }[];

  let checked = 0;
  let valid = 0;
  let invalid = 0;
  const validIds: string[] = [];
  const invalidIds: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE);
    const jids = slice.map((r) => toJid(r.phone_normalized));

    let results: any[] = [];
    try {
      results = (await sock.onWhatsApp(...jids)) ?? [];
    } catch (err) {
      // Baileys ocasionalmente lança em batch grande — degrada por item.
      results = [];
      for (const jid of jids) {
        try {
          const r = await sock.onWhatsApp(jid);
          if (Array.isArray(r) && r[0]) results.push(r[0]);
        } catch {
          // ignora item
        }
      }
    }

    const existsByJid = new Map<string, boolean>();
    for (const r of results) {
      if (r?.jid) existsByJid.set(r.jid, !!r.exists);
    }

    for (let j = 0; j < slice.length; j += 1) {
      const row = slice[j];
      const jid = jids[j];
      const exists = existsByJid.get(jid) ?? false;
      checked += 1;
      if (exists) {
        valid += 1;
        validIds.push(row.id);
      } else {
        invalid += 1;
        invalidIds.push(row.id);
      }
    }
  }

  try {
    if (validIds.length > 0) await markValidWhatsApp(validIds, true);
    if (invalidIds.length > 0) await markValidWhatsApp(invalidIds, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao salvar validação";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true, checked, valid, invalid });
}