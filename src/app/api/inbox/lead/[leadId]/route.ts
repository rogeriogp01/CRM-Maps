import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

type RouteParams = { params: Promise<{ leadId: string }> };

/**
 * GET /api/inbox/lead/[leadId]
 *
 * Devolve dados do lead + colunas do CRM + últimas 50 entradas de histórico
 * para popular o painel direito do Inbox.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { leadId } = await params;

  const [leadRes, columnsRes, historyRes] = await Promise.all([
    supabaseAdmin
      .from("crm_leads")
      .select(
        "id, name, phone, phone_normalized, email, company, origin, status, tags, notes, assigned_to, whatsapp_account_id, last_interaction_at, created_at, updated_at"
      )
      .eq("id", leadId)
      .maybeSingle(),
    supabaseAdmin
      .from("crm_columns")
      .select("id, name, order, color")
      .order("order", { ascending: true }),
    supabaseAdmin
      .from("crm_history")
      .select("id, type, message, whatsapp_account_id, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (leadRes.error || !leadRes.data) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }

  return NextResponse.json({
    lead: leadRes.data,
    columns: columnsRes.data ?? [],
    history: historyRes.data ?? [],
  });
}
