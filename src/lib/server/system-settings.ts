import { supabaseAdmin } from "./supabase-admin";

/**
 * Identidade global do operador. Singleton no banco — id fixo abaixo.
 * Use getSystemSettings() em qualquer rota server-side que precise
 * substituir {{meu_nome}}, {{meu_whatsapp}}, {{minha_empresa}}, {{meu_site}}.
 *
 * ROGA-42: estendido com configuração de opt-out automático
 * (`opt_out_keywords`, `opt_out_confirmation_message`).
 */

export const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

// Defaults usados quando o banco ainda não tem a migration 012 aplicada
// ou quando algum campo veio nulo (resiliência). Manter alinhado com
// `database/012_opt_out_config.sql`.
export const DEFAULT_OPT_OUT_KEYWORDS: readonly string[] = Object.freeze([
  "SAIR",
  "STOP",
  "PARAR",
  "DESCADASTRAR",
]);

export const DEFAULT_OPT_OUT_CONFIRMATION =
  "Recebido. Removemos seu número da nossa lista e você não receberá mais mensagens nossas. Caso queira voltar a falar conosco, é só responder esta conversa.";

export type SystemSettings = {
  operator_name: string | null;
  operator_whatsapp: string | null;
  company_name: string | null;
  company_website: string | null;
  opt_out_keywords: string[];
  opt_out_confirmation_message: string;
};

const EMPTY: SystemSettings = {
  operator_name: null,
  operator_whatsapp: null,
  company_name: null,
  company_website: null,
  opt_out_keywords: [...DEFAULT_OPT_OUT_KEYWORDS],
  opt_out_confirmation_message: DEFAULT_OPT_OUT_CONFIRMATION,
};

function sanitizeKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_OPT_OUT_KEYWORDS];
  const cleaned = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_OPT_OUT_KEYWORDS];
}

export async function getSystemSettings(): Promise<SystemSettings> {
  const { data, error } = await supabaseAdmin
    .from("system_settings")
    .select(
      "operator_name, operator_whatsapp, company_name, company_website, opt_out_keywords, opt_out_confirmation_message"
    )
    .eq("id", SETTINGS_ID)
    .maybeSingle();

  if (error || !data) return { ...EMPTY };

  const confirmation =
    typeof data.opt_out_confirmation_message === "string" &&
    data.opt_out_confirmation_message.trim() !== ""
      ? data.opt_out_confirmation_message
      : DEFAULT_OPT_OUT_CONFIRMATION;

  return {
    operator_name: data.operator_name ?? null,
    operator_whatsapp: data.operator_whatsapp ?? null,
    company_name: data.company_name ?? null,
    company_website: data.company_website ?? null,
    opt_out_keywords: sanitizeKeywords(data.opt_out_keywords),
    opt_out_confirmation_message: confirmation,
  };
}

export async function upsertSystemSettings(
  input: Partial<SystemSettings>
): Promise<void> {
  const payload: Record<string, unknown> = {};

  const stringKeys: (keyof SystemSettings)[] = [
    "operator_name",
    "operator_whatsapp",
    "company_name",
    "company_website",
  ];

  for (const key of stringKeys) {
    if (key in input) {
      const v = input[key];
      payload[key] = typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    }
  }

  if ("opt_out_keywords" in input) {
    payload.opt_out_keywords = sanitizeKeywords(input.opt_out_keywords);
  }

  if ("opt_out_confirmation_message" in input) {
    const v = input.opt_out_confirmation_message;
    payload.opt_out_confirmation_message =
      typeof v === "string" && v.trim() !== ""
        ? v.trim()
        : DEFAULT_OPT_OUT_CONFIRMATION;
  }

  const { error } = await supabaseAdmin
    .from("system_settings")
    .upsert({
      id: SETTINGS_ID,
      ...payload,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Verifica se um corpo de mensagem recebida corresponde a uma palavra-chave
 * de opt-out. Comparação case-insensitive, com trim e remoção de pontuação
 * comum no início/fim ("STOP!", "  sair.  ", "Parar?").
 *
 * Match é EXATO contra a mensagem inteira normalizada — não consideramos
 * "vou sair em 5 min" um opt-out. O contato precisa enviar apenas a palavra
 * (eventualmente com pontuação/espaço).
 */
export function matchesOptOut(
  body: string | null | undefined,
  keywords: readonly string[]
): { matched: true; keyword: string } | { matched: false } {
  if (!body || typeof body !== "string") return { matched: false };
  const normalized = body
    .trim()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .toUpperCase();
  if (normalized.length === 0) return { matched: false };

  for (const keyword of keywords) {
    if (typeof keyword !== "string") continue;
    const k = keyword.trim().toUpperCase();
    if (k.length === 0) continue;
    if (normalized === k) return { matched: true, keyword: k };
  }
  return { matched: false };
}
