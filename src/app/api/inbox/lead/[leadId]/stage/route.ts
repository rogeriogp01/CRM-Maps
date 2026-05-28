import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { appendCrmHistory } from "@/lib/crm";

type RouteParams = { params: Promise<{ leadId: string }> };

/**
 * PATCH /api/inbox/lead/[leadId]/stage
 * Body: { status: string }
 *
 * Espelha a lógica de /api/crm/leads/[id]/status para evitar acoplamento
 * cross-fetch entre rotas. Atualiza status + grava em crm_history.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { leadId } = await params;
  const body = await request.json().catch(() => ({}));
  const status = typeof body?.status === "string" ? body.status.trim() : "";

  if (!status) {
    return NextResponse.json({ error: "Status é obrigatório" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("crm_leads")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .select("id, status, whatsapp_account_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await appendCrmHistory({
    lead_id: leadId,
    type: "status_changed",
    message: `Status alterado para ${status} (via Inbox)`,
    whatsapp_account_id: data.whatsapp_account_id,
  });

  return NextResponse.json({ success: true, status: data.status });
}
