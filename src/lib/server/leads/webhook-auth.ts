import { createHmac, timingSafeEqual } from "crypto";

/**
 * Webhook authentication for Outscraper callbacks.
 *
 * Outscraper itself does NOT sign payloads — its callback contract is "we will
 * POST to whatever URL you configure". So we defend the endpoint two ways:
 *
 *   1. **Shared token in the URL.** `OUTSCRAPER_WEBHOOK_TOKEN` must be present
 *      as a `?token=` query param. Outscraper preserves the configured URL
 *      verbatim, so this is sufficient for "is this request from the URL we
 *      handed out?".
 *   2. **Optional HMAC envelope.** If `OUTSCRAPER_WEBHOOK_HMAC_SECRET` is set,
 *      the receiver also verifies an `X-Signature-256` header computed as
 *      `sha256=hex(hmac(secret, rawBody))`. This is useful when running the
 *      webhook behind a relay (Cloudflare Worker, etc.) that re-signs the
 *      request — turn it on once that relay is in place. Until then,
 *      leave the secret unset and rely on the token.
 *
 * Both checks use timing-safe comparisons so a slow attacker can't probe
 * tokens character-by-character.
 */

export function verifyWebhookToken(provided: string | null | undefined): boolean {
  const expected = process.env.OUTSCRAPER_WEBHOOK_TOKEN;
  if (!expected) {
    // Refuse if not configured — better to fail closed than silently accept.
    console.error("[outscraper/webhook] OUTSCRAPER_WEBHOOK_TOKEN is not set; rejecting all callbacks");
    return false;
  }
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyHmacSignature(rawBody: string, header: string | null | undefined): boolean {
  const secret = process.env.OUTSCRAPER_WEBHOOK_HMAC_SECRET;
  if (!secret) return true; // HMAC is opt-in; if not configured, skip this layer.
  if (!header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
