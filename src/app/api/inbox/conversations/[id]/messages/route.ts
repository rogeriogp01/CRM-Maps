// TODO(ROGA-49): usar getCurrentWorkspaceId() de "@/lib/server/workspace"
//   antes de filtrar/inserir em tabelas multi-tenant. Aguarda Fase 2
//   (FK workspace_id) + Fase 3 (RLS) para migrar de forma segura.
//   Ver ROGA-74 para o helper.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getSocket } from "@/lib/whatsapp-manager";
import { recordOutgoingMessage } from "@/lib/server/inbox";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/inbox/conversations/[id]/messages?before=<iso>&limit=50
 *
 * Histórico paginado (keyset por timestamp). Mais recentes primeiro;
 * o front inverte ao renderizar.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const before = searchParams.get("before");
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  let query = supabaseAdmin
    .from("chat_messages")
    .select(
      "id, conversation_id, baileys_message_id, direction, from_me, type, body, media_url, media_mime, status, timestamp, created_at"
    )
    .eq("conversation_id", id)
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt("timestamp", before);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: (data ?? []).reverse() });
}

/**
 * POST /api/inbox/conversations/[id]/messages
 * Body: { text: string }
 *
 * Envia mensagem via Baileys e grava em chat_messages imediatamente
 * (fonte única de verdade — o echo do messages.upsert vira no-op por
 * upsert em (conversation_id, baileys_message_id)).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const text = typeof body?.text === "string" ? body.text : "";

  if (!text.trim()) {
    return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });
  }

  // Carrega conversa para descobrir account_id + JID
  const { data: conv, error: convErr } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, account_id, contact_jid")
    .eq("id", id)
    .maybeSingle();

  if (convErr || !conv) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const sock = getSocket(conv.account_id);
  if (!sock || typeof sock.sendMessage !== "function") {
    return NextResponse.json(
      { error: "Conta WhatsApp não está conectada" },
      { status: 503 }
    );
  }

  try {
    const sendResult: any = await sock.sendMessage(conv.contact_jid, { text });
    const messageId: string | null = sendResult?.key?.id ?? null;
    if (!messageId) {
      return NextResponse.json({ error: "Envio sem messageId" }, { status: 500 });
    }

    await recordOutgoingMessage({
      conversationId: conv.id,
      baileysMessageId: messageId,
      type: "text",
      body: text,
      mediaUrl: null,
      mediaMime: null,
    });

    return NextResponse.json({ ok: true, messageId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}