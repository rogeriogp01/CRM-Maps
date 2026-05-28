import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

/**
 * GET /api/inbox/conversations
 *
 * Lista todas as conversas ordenadas por last_message_at desc.
 * Faz join com crm_leads (name, status) e whatsapp_accounts (name, phone)
 * para a sidebar do Inbox.
 */
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("chat_conversations")
    .select(
      `
        id,
        account_id,
        contact_jid,
        contact_name,
        lead_id,
        unread_count,
        last_message_at,
        last_message_preview,
        updated_at,
        crm_leads:lead_id ( id, name, status ),
        whatsapp_accounts:account_id ( id, name, phone )
      `
    )
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data ?? [] });
}
