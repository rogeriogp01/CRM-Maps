/**
 * Chat-media bucket helpers (ROGA-35).
 *
 * O bucket `chat-media` é privado. URLs nunca devem ser retornadas como
 * `getPublicUrl` — o cliente deve receber uma **signed URL** com TTL.
 *
 * Convenções:
 *  - `chat_messages.media_url` armazena o **storage path** (ex.:
 *    `<accountId>/<baileysMessageId>.<ext>`), NÃO a URL pública.
 *  - Por compatibilidade com linhas antigas (que ainda contêm URLs públicas
 *    geradas pela versão pré-ROGA-35), `extractStoragePath` reconhece e
 *    extrai o path quando recebe uma URL completa.
 *  - O TTL padrão é `CHAT_MEDIA_SIGNED_URL_TTL` (10 min). A UI deve
 *    re-buscar a URL antes do TTL expirar (ou renderizar do response que
 *    vem do servidor, que já tem TTL fresco).
 */
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export const CHAT_MEDIA_BUCKET = "chat-media";

/** TTL padrão da signed URL, em segundos. */
export const CHAT_MEDIA_SIGNED_URL_TTL = 60 * 10; // 10 minutos

/**
 * Dado um valor armazenado em `chat_messages.media_url`, devolve o
 * storage path relativo ao bucket `chat-media`.
 *
 * Aceita:
 *   - paths já relativos (ex.: `acc-123/MSG_XYZ.jpg`)
 *   - URLs públicas do Supabase Storage:
 *     `<host>/storage/v1/object/public/chat-media/<path>`
 *   - URLs signed antigas:
 *     `<host>/storage/v1/object/sign/chat-media/<path>?token=...`
 *
 * Retorna `null` se o input não puder ser interpretado.
 */
export function extractStoragePath(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Path relativo direto — heurística: sem esquema e sem `/storage/v1/`.
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith("/")) {
    return trimmed;
  }

  // URL Supabase Storage: tenta extrair tudo após `/<bucket>/`.
  const marker = `/${CHAT_MEDIA_BUCKET}/`;
  const idx = trimmed.indexOf(marker);
  if (idx === -1) return null;
  const rest = trimmed.slice(idx + marker.length);
  // remove querystring se houver (ex.: signed URL com ?token=...)
  const qIdx = rest.indexOf("?");
  const path = qIdx === -1 ? rest : rest.slice(0, qIdx);
  return path || null;
}

/**
 * Gera uma signed URL para o path informado (ou para o valor bruto vindo
 * de `chat_messages.media_url`, que pode ser path ou URL legada).
 *
 * Retorna `null` em qualquer falha (path inválido, objeto inexistente,
 * erro do Storage). O chamador trata `null` como "mídia indisponível".
 */
export async function signChatMediaUrl(
  rawPathOrUrl: string | null | undefined,
  ttlSeconds: number = CHAT_MEDIA_SIGNED_URL_TTL,
): Promise<string | null> {
  const path = extractStoragePath(rawPathOrUrl);
  if (!path) return null;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(CHAT_MEDIA_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    if (error) {
      console.error(
        `[chat-media] createSignedUrl falhou para ${path}: ${error.message}`,
      );
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (err) {
    console.error("[chat-media] signChatMediaUrl exception:", err);
    return null;
  }
}

/**
 * Resolve `media_url` para um array de mensagens (transforma path → signed URL).
 * Devolve um novo array com `media_url` substituído pela signed URL fresca.
 * Mensagens sem mídia (`media_url` null) passam intactas.
 *
 * Use isto em qualquer endpoint que devolva linhas de `chat_messages` ao
 * cliente.
 */
export async function attachSignedMediaUrls<
  T extends { media_url: string | null },
>(messages: T[], ttlSeconds: number = CHAT_MEDIA_SIGNED_URL_TTL): Promise<T[]> {
  if (!messages.length) return messages;

  return Promise.all(
    messages.map(async (m) => {
      if (!m.media_url) return m;
      const signed = await signChatMediaUrl(m.media_url, ttlSeconds);
      return { ...m, media_url: signed };
    }),
  );
}
