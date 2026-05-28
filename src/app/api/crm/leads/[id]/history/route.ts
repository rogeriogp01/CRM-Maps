import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("crm_history")
    .select("id,lead_id,type,message,whatsapp_account_id,created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ history: data ?? [] });
}
