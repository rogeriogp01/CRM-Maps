/**
 * POST /api/inbox/sign-media
 * Body: { path: string }
 * Resp: { signedUrl: string, expiresIn: number }
 *
 * ROGA-35: o bucket `chat-media` é privado. Mensagens novas chegam à UI via
 * Realtime com `media_url = storage path` (ex.: `acc-123/MSG.jpg`). Este
 * endpoint converte um path em signed URL com TTL — a UI usa ele quando
 * recebe um path em vez de uma URL pronta.
 *
 * Aceita também URLs públicas/legadas (faz extração via extractStoragePath),
 * então o cliente pode encaminhar `media_url` cru sem se preocupar com o
 * formato.
 *
 * Códigos de status:
 *   400 — body sem `path`, ou `path` não é mapeável para um storage path
 *         válido (URL sem o segmento `/chat-media/`, string vazia, etc).
 *   500 — falha do Storage ao gerar a signed URL (transitório ou objeto
 *         inexistente). UI deve mostrar `[mídia indisponível]` e/ou tentar
 *         de novo.
 */
import { NextResponse } from "next/server";
import {
  CHAT_MEDIA_SIGNED_URL_TTL,
  extractStoragePath,
  signChatMediaUrl,
} from "@/lib/server/chat-media";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rawPath = typeof body?.path === "string" ? body.path : null;

  if (!rawPath) {
    return NextResponse.json(
      { error: "path é obrigatório" },
      { status: 400 },
    );
  }

  // Validação de forma: path não-mapeável → 400 (entrada inválida do cliente).
  const normalized = extractStoragePath(rawPath);
  if (!normalized) {
    return NextResponse.json(
      { error: "path inválido para bucket chat-media" },
      { status: 400 },
    );
  }

  // Falha de Storage (objeto não existe, erro transitório, etc) → 500.
  const signedUrl = await signChatMediaUrl(normalized);
  if (!signedUrl) {
    return NextResponse.json(
      { error: "falha ao gerar signed URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    signedUrl,
    expiresIn: CHAT_MEDIA_SIGNED_URL_TTL,
  });
}
