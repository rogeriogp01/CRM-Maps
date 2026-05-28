import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { appendCrmHistory } from "@/lib/crm";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!note) {
    return NextResponse.json({ error: "Nota é obrigatória" }, { status: 400 });
  }

  const { data: lead, error: leadError } = await supabaseAdmin
    .from("crm_leads")
    .select("id,notes,whatsapp_account_id")
    .eq("id", id)
    .single();

  if (leadError || !lead) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }

  const mergedNotes = lead.notes ? `${lead.notes}\n- ${note}` : `- ${note}`;

  const { error } = await supabaseAdmin
    .from("crm_leads")
    .update({ notes: mergedNotes, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await appendCrmHistory({
    lead_id: id,
    type: "note_added",
    message: note,
    whatsapp_account_id: lead.whatsapp_account_id,
  });

  return NextResponse.json({ success: true });
}
