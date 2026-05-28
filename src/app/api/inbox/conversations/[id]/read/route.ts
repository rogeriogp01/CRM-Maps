import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/inbox/conversations/[id]/read
 *
 * Marca conversa como lida internamente: zera unread_count.
 * NÃO envia read receipt para o WhatsApp (fora de escopo v1).
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const { error } = await supabaseAdmin
    .from("chat_conversations")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
