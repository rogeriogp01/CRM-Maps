/**
 * Util de substituição de placeholders {{var}} em templates de mensagem.
 *
 * Isomórfico (sem dependência de runtime do Next). Pode ser usado tanto no
 * server quanto no client. A regex tolera espaços (`{{ nome }}`) e variáveis
 * desconhecidas/vazias viram string vazia para não quebrar a mensagem final.
 */

export type TemplateVars = {
  nome?: string | null;
  empresa?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  meu_nome?: string | null;
  meu_whatsapp?: string | null;
  minha_empresa?: string | null;
  meu_site?: string | null;
};

export const SUPPORTED_VARS = [
  "nome",
  "empresa",
  "telefone",
  "endereco",
  "meu_nome",
  "meu_whatsapp",
  "minha_empresa",
  "meu_site",
] as const;

export type SupportedVar = (typeof SUPPORTED_VARS)[number];

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function renderTemplate(template: string, vars: TemplateVars): string {
  if (typeof template !== "string" || template === "") return "";
  return template.replace(PLACEHOLDER_REGEX, (_full, key: string) => {
    const lookup = key.toLowerCase();
    const value = (vars as Record<string, string | null | undefined>)[lookup];
    return typeof value === "string" && value.trim() !== "" ? value : "";
  });
}

/**
 * Labels amigáveis para exibir no dropdown "Inserir Variável".
 */
export const VAR_LABELS: Record<SupportedVar, string> = {
  nome: "Nome do lead",
  empresa: "Empresa do lead",
  telefone: "Telefone do lead",
  endereco: "Endereço do lead",
  meu_nome: "Meu nome (operador)",
  meu_whatsapp: "Meu WhatsApp (operador)",
  minha_empresa: "Minha empresa",
  meu_site: "Meu site",
};
