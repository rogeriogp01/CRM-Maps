/**
 * POST /api/inbox/sign-media
 * Body: { path: string }
 * Resp: { signedUrl: string | null, expiresIn: number }
 *
 * ROGA-35: o bucket `chat-media` é privado. Mensagens novas chegam à UI via
 * Realtime com `media_url = storage path` (ex.: `acc-123/MSG.jpg`). Este
 * endpoint converte um path em signed URL com TTL — a UI usa ele quando
 * recebe um path em vez de uma URL pronta.
 *
 * Aceita também URLs públicas/legadas (faz extração via extractStoragePath),
 * então o cliente pode encaminhar `media_url` cru sem se preocupar com o
 * formato.
 */
import { NextResponse } from "next/server";
import {
  CHAT_MEDIA_SIGNED_URL_TTL,
  signChatMediaUrl,
} from "@/lib/server/chat-media";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const path = typeof body?.path === "string" ? body.path : null;

  if (!path) {
    return NextResponse.json(
      { error: "path é obrigatório" },
      { status: 400 },
    );
  }

  const signedUrl = await signChatMediaUrl(path);

  if (!signedUrl) {
    return NextResponse.json(
      { signedUrl: null, expiresIn: CHAT_MEDIA_SIGNED_URL_TTL },
      { status: 404 },
    );
  }

  return NextResponse.json({
    signedUrl,
    expiresIn: CHAT_MEDIA_SIGNED_URL_TTL,
  });
}
