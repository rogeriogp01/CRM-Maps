import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getSocket } from "@/lib/whatsapp-manager";
import { recordOutgoingMessage } from "@/lib/server/inbox";

type RouteParams = { params: Promise<{ id: string }> };

function detectKindFromMime(mime: string): {
  baileysKey: "image" | "audio" | "video" | "document";
  type: "image" | "audio" | "video" | "document";
} {
  if (mime.startsWith("image/")) return { baileysKey: "image", type: "image" };
  if (mime.startsWith("audio/")) return { baileysKey: "audio", type: "audio" };
  if (mime.startsWith("video/")) return { baileysKey: "video", type: "video" };
  return { baileysKey: "document", type: "document" };
}

function extensionForMime(mime: string): string {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("pdf")) return "pdf";
  const slash = mime.indexOf("/");
  if (slash >= 0) return mime.slice(slash + 1).split(";")[0] || "bin";
  return "bin";
}

/**
 * POST /api/inbox/conversations/[id]/attach
 * multipart/form-data: { file: File, caption?: string }
 *
 * Faz upload no bucket chat-media, envia via Baileys, grava em chat_messages.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Form data inválido" }, { status: 400 });
  }

  const file = formData.get("file");
  const caption = (formData.get("caption") as string | null) ?? null;

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Arquivo ausente" }, { status: 400 });
  }

  // Carrega conversa
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, account_id, contact_jid")
    .eq("id", id)
    .maybeSingle();

  if (!conv) {
    return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  }

  const sock = getSocket(conv.account_id);
  if (!sock || typeof sock.sendMessage !== "function") {
    return NextResponse.json(
      { error: "Conta WhatsApp não está conectada" },
      { status: 503 }
    );
  }

  const arrayBuf = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const mime = file.type || "application/octet-stream";
  const ext = extensionForMime(mime);

  // Upload no Storage
  const tempId = `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `${conv.account_id}/${tempId}.${ext}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("chat-media")
    .upload(storagePath, buffer, { contentType: mime, upsert: true });
  if (upErr) {
    return NextResponse.json({ error: `Upload falhou: ${upErr.message}` }, { status: 500 });
  }
  const { data: pub } = supabaseAdmin.storage.from("chat-media").getPublicUrl(storagePath);
  const publicUrl = pub?.publicUrl ?? null;

  // Envia via Baileys
  const { baileysKey, type } = detectKindFromMime(mime);
  try {
    const messageContent: any = {
      mimetype: mime,
    };
    messageContent[baileysKey] = buffer;
    if (caption && (type === "image" || type === "video" || type === "document")) {
      messageContent.caption = caption;
    }
    if (type === "document") {
      const fileName = (file as any)?.name ?? `arquivo.${ext}`;
      messageContent.fileName = fileName;
    }

    const sendResult: any = await sock.sendMessage(conv.contact_jid, messageContent);
    const messageId: string | null = sendResult?.key?.id ?? null;

    if (!messageId) {
      return NextResponse.json({ error: "Envio sem messageId" }, { status: 500 });
    }

    await recordOutgoingMessage({
      conversationId: conv.id,
      baileysMessageId: messageId,
      type,
      body: caption,
      mediaUrl: publicUrl,
      mediaMime: mime,
    });

    return NextResponse.json({ ok: true, messageId, mediaUrl: publicUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
