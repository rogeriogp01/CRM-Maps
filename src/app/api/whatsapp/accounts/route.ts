import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getWhatsAppLiveState } from "@/lib/whatsapp-manager";

type AccountStatus = "connected" | "disconnected" | "connecting" | "error";

type WhatsAppAccount = {
  id: string;
  name: string;
  phone: string | null;
  status: AccountStatus;
  session_id: string;
  qr_code: string | null;
  last_connection_at: string | null;
  created_at: string;
  updated_at: string;
};

function isMissingWhatsAppAccountsTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return (error.message ?? "").includes("public.whatsapp_accounts");
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("whatsapp_accounts")
    .select("id,name,phone,status,session_id,qr_code,last_connection_at,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingWhatsAppAccountsTable(error)) {
      return NextResponse.json({ accounts: [], warning: "Tabela whatsapp_accounts ainda não criada." });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enriched = (data as WhatsAppAccount[]).map((account) => {
    const live = getWhatsAppLiveState(account.id);
    if (!live) return account;

    return {
      ...account,
      status: live.status,
      phone: live.phone ?? account.phone,
      qr_code: live.qr ?? account.qr_code,
    };
  });

  return NextResponse.json({ accounts: enriched });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Nome da conta é obrigatório" }, { status: 400 });
  }

  const payload = {
    id: randomUUID(),
    name,
    phone: null,
    status: "disconnected" as AccountStatus,
    session_id: `wa_${randomUUID()}`,
    qr_code: null,
    last_connection_at: null,
  };

  const { data, error } = await supabaseAdmin
    .from("whatsapp_accounts")
    .insert(payload)
    .select("id,name,phone,status,session_id,qr_code,last_connection_at,created_at,updated_at")
    .single();

  if (error) {
    if (isMissingWhatsAppAccountsTable(error)) {
      return NextResponse.json(
        { error: "A tabela whatsapp_accounts não existe no banco. Execute a migration 001_create_whatsapp_accounts.sql." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ account: data }, { status: 201 });
}
