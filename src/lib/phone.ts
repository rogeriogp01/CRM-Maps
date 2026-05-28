/**
 * Utils de telefone (isomórfico — usado em client + server).
 *
 * Estratégia: normalizar para string só de dígitos, sem +, e com prefixo
 * de país. Brasil-first (default 55) mas aceita explícitos.
 */

const BR_DEFAULT_DDI = "55";

/**
 * Remove todos os caracteres não-numéricos. Se o resultado tiver de 10 a 11
 * dígitos (DDD+número BR), prefixa 55. Aceita até 13 dígitos (DDI+DDD+número).
 */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length >= 10 && digits.length <= 11) {
    return BR_DEFAULT_DDI + digits;
  }
  return digits;
}

/**
 * Telefone válido se, após normalização, tiver entre 10 e 15 dígitos
 * (faixa E.164). Não checa se é WhatsApp — isso é tarefa do Baileys
 * onWhatsApp().
 */
export function isValidPhone(raw: string | null | undefined): boolean {
  const n = normalizePhone(raw);
  return n.length >= 10 && n.length <= 15;
}

/**
 * Formata para exibição: "+55 (11) 98888-7777" (Brasil 11 dígitos)
 * ou "+55 (11) 8888-7777" (Brasil 10 dígitos), fallback +XX YYYYYYYY.
 */
export function formatPhone(normalized: string | null | undefined): string {
  const n = normalizePhone(normalized);
  if (n.length === 13 && n.startsWith("55")) {
    const ddd = n.slice(2, 4);
    const a = n.slice(4, 9);
    const b = n.slice(9);
    return `+55 (${ddd}) ${a}-${b}`;
  }
  if (n.length === 12 && n.startsWith("55")) {
    const ddd = n.slice(2, 4);
    const a = n.slice(4, 8);
    const b = n.slice(8);
    return `+55 (${ddd}) ${a}-${b}`;
  }
  return n ? `+${n}` : "";
}

/**
 * Retorna o JID do Baileys (sufixo @s.whatsapp.net).
 */
export function toJid(normalized: string): string {
  return `${normalized}@s.whatsapp.net`;
}
