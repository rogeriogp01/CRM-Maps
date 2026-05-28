import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { appendCrmHistory, normalizePhone, validateLeadInput } from "@/lib/crm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status")?.trim();

  let query = supabaseAdmin
    .from("crm_leads")
    .select("id,name,phone,email,company,origin,status,tags,notes,assigned_to,whatsapp_account_id,last_interaction_at,created_at,updated_at")
    .order("updated_at", { ascending: false });

  if (search) {
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ leads: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const validationError = validateLeadInput(body, true);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const payload = {
    name: body.name.trim(),
    phone: normalizePhone(body.phone),
    email: typeof body.email === "string" ? body.email.trim() || null : null,
    company: typeof body.company === "string" ? body.company.trim() || null : null,
    origin: typeof body.origin === "string" ? body.origin.trim() || "manual" : "manual",
    status: body.status.trim(),
    tags: Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === "string") : [],
    notes: typeof body.notes === "string" ? body.notes : null,
    assigned_to: typeof body.assigned_to === "string" ? body.assigned_to : null,
    whatsapp_account_id: typeof body.whatsapp_account_id === "string" ? body.whatsapp_account_id : null,
  };

  const { data, error } = await supabaseAdmin
    .from("crm_leads")
    .insert(payload)
    .select("id,name,phone,email,company,origin,status,tags,notes,assigned_to,whatsapp_account_id,last_interaction_at,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await appendCrmHistory({
    lead_id: data.id,
    type: "lead_created",
    message: `Lead criado (${data.origin})`,
    whatsapp_account_id: data.whatsapp_account_id,
  });

  return NextResponse.json({ lead: data }, { status: 201 });
}
