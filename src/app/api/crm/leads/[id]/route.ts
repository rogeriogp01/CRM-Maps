import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { appendCrmHistory, normalizePhone, validateLeadInput } from "@/lib/crm";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const validationError = validateLeadInput(body, false);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.phone === "string") patch.phone = normalizePhone(body.phone);
  if (typeof body.email === "string" || body.email === null) patch.email = body.email ? body.email.trim() : null;
  if (typeof body.company === "string" || body.company === null) patch.company = body.company ? body.company.trim() : null;
  if (typeof body.origin === "string") patch.origin = body.origin.trim();
  if (typeof body.status === "string") patch.status = body.status.trim();
  if (Array.isArray(body.tags)) patch.tags = body.tags.filter((t: unknown) => typeof t === "string");
  if (typeof body.notes === "string" || body.notes === null) patch.notes = body.notes;
  if (typeof body.assigned_to === "string" || body.assigned_to === null) patch.assigned_to = body.assigned_to;
  if (typeof body.whatsapp_account_id === "string" || body.whatsapp_account_id === null) patch.whatsapp_account_id = body.whatsapp_account_id;

  const { data, error } = await supabaseAdmin
    .from("crm_leads")
    .update(patch)
    .eq("id", id)
    .select("id,name,phone,email,company,origin,status,tags,notes,assigned_to,whatsapp_account_id,last_interaction_at,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await appendCrmHistory({
    lead_id: data.id,
    type: "lead_updated",
    message: "Lead atualizado",
    whatsapp_account_id: data.whatsapp_account_id,
  });

  return NextResponse.json({ lead: data });
}

export async function DELETE(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const { error } = await supabaseAdmin.from("crm_leads").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
