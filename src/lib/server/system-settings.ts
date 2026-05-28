import { supabaseAdmin } from "./supabase-admin";

/**
 * Identidade global do operador. Singleton no banco — id fixo abaixo.
 * Use getSystemSettings() em qualquer rota server-side que precise
 * substituir {{meu_nome}}, {{meu_whatsapp}}, {{minha_empresa}}, {{meu_site}}.
 */

export const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

export type SystemSettings = {
  operator_name: string | null;
  operator_whatsapp: string | null;
  company_name: string | null;
  company_website: string | null;
};

const EMPTY: SystemSettings = {
  operator_name: null,
  operator_whatsapp: null,
  company_name: null,
  company_website: null,
};

export async function getSystemSettings(): Promise<SystemSettings> {
  const { data, error } = await supabaseAdmin
    .from("system_settings")
    .select("operator_name, operator_whatsapp, company_name, company_website")
    .eq("id", SETTINGS_ID)
    .maybeSingle();

  if (error || !data) return EMPTY;

  return {
    operator_name: data.operator_name ?? null,
    operator_whatsapp: data.operator_whatsapp ?? null,
    company_name: data.company_name ?? null,
    company_website: data.company_website ?? null,
  };
}

export async function upsertSystemSettings(
  input: Partial<SystemSettings>
): Promise<void> {
  const payload: Record<string, string | null> = {};
  const keys: (keyof SystemSettings)[] = [
    "operator_name",
    "operator_whatsapp",
    "company_name",
    "company_website",
  ];

  for (const key of keys) {
    if (key in input) {
      const v = input[key];
      payload[key] = typeof v === "string" && v.trim() !== "" ? v.trim() : null;
    }
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
