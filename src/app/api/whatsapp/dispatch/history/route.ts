import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { appendCrmHistory } from "@/lib/crm";
import { getSystemSettings } from "@/lib/server/system-settings";
import { renderTemplate, type TemplateVars } from "@/lib/template";

type LeadInput = {
  nome?: string;
  empresa?: string;
  telefone?: string;
  endereco?: string;
};

function parseLead(raw: unknown): LeadInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: LeadInput = {};
  if (typeof r.nome === "string") out.nome = r.nome;
  if (typeof r.empresa === "string") out.empresa = r.empresa;
  if (typeof r.telefone === "string") out.telefone = r.telefone;
  if (typeof r.endereco === "string") out.endereco = r.endereco;
  return out;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const payload = {
    contact_phone: typeof body.contact_phone === "string" ? body.contact_phone : null,
    whatsapp_account_id: typeof body.whatsapp_account_id === "string" ? body.whatsapp_account_id : null,
    message_used: typeof body.message_used === "string" ? body.message_used : null,
    status: typeof body.status === "string" ? body.status : "failed",
    error: typeof body.error === "string" ? body.error : null,
  };

  if (!payload.contact_phone || !payload.whatsapp_account_id || !payload.message_used) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
  }

  // Backward compat: se `lead` ausente no body, salva o template literal (comportamento antigo).
  // Quando presente, resolve placeholders {{nome}}, {{meu_nome}} etc. no backend.
  const lead = parseLead(body.lead);
  let resolvedMessage = payload.message_used;

  if (lead) {
    try {
      const settings = await getSystemSettings();
      const vars: TemplateVars = {
        nome: lead.nome ?? null,
        empresa: lead.empresa ?? null,
        telefone: lead.telefone ?? null,
        endereco: lead.endereco ?? null,
        meu_nome: settings.operator_name,
        meu_whatsapp: settings.operator_whatsapp,
        minha_empresa: settings.company_name,
        meu_site: settings.company_website,
      };
      resolvedMessage = renderTemplate(payload.message_used, vars);
    } catch {
      // Em falha de leitura de settings, mantém o template literal — não bloqueia o disparo.
      resolvedMessage = payload.message_used;
    }
  }

  const insertPayload = { ...payload, message_used: resolvedMessage };

  const { error } = await supabaseAdmin.from("message_dispatch_history").insert(insertPayload);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const normalizedPhone = payload.contact_phone.replace(/\D/g, "");
  const { data: leadRow } = await supabaseAdmin
    .from("crm_leads")
    .select("id")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (leadRow?.id) {
    await supabaseAdmin
      .from("crm_leads")
      .update({ last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", leadRow.id);

    await appendCrmHistory({
      lead_id: leadRow.id,
      type: payload.status === "sent" ? "dispatch_sent" : "dispatch_failed",
      message: `${resolvedMessage}${payload.error ? ` | erro: ${payload.error}` : ""}`,
      whatsapp_account_id: payload.whatsapp_account_id,
    });
  }

  return NextResponse.json({ success: true, rendered: resolvedMessage });
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("message_dispatch_history")
    .select("id,contact_phone,whatsapp_account_id,message_used,status,error,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ history: data ?? [] });
}
