/**
 * Groq AI service — gera variações de mensagens para WhatsApp.
 *
 * Usa a API compatível com schema OpenAI da Groq (chat completions).
 * Não adiciona SDK novo — segue padrão de fetch direto do projeto.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";

export class GroqConfigError extends Error {
  constructor(message = "GROQ_API_KEY não configurada") {
    super(message);
    this.name = "GroqConfigError";
  }
}

export class GroqResponseError extends Error {
  constructor(message = "Resposta inválida da IA") {
    super(message);
    this.name = "GroqResponseError";
  }
}

function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 5;
  return Math.max(1, Math.min(5, Math.trunc(count)));
}

function buildSystemPrompt(count: number): string {
  return `Você é um copywriter especialista em WhatsApp B2B.
Gere ${count} variações curtas, naturais e humanizadas da mensagem abaixo.
Preserve EXATAMENTE todas as variáveis entre chaves duplas que aparecerem na mensagem base, sem traduzir, remover ou alterar:
- Variáveis do lead: {{nome}}, {{empresa}}, {{telefone}}, {{endereco}}
- Variáveis do operador: {{meu_nome}}, {{meu_whatsapp}}, {{minha_empresa}}, {{meu_site}}
Não prometa resultados garantidos.
Não use linguagem agressiva.
Não crie dados falsos.
Tom natural, humano e comercial.
Retorne apenas JSON válido neste formato:
{
  "variations": ["mensagem 1", "mensagem 2"]
}`;
}

export async function generateMessageVariations(
  baseMessage: string,
  count: number
): Promise<string[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new GroqConfigError();
  }

  const safeCount = clampCount(count);
  const systemPrompt = buildSystemPrompt(safeCount);
  const userPrompt = `Mensagem base:\n${baseMessage}`;

  let response: Response;
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Falha de rede";
    throw new Error(`Falha ao contatar Groq: ${msg}`);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Groq retornou ${response.status}: ${errText.slice(0, 200)}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GroqResponseError("Groq retornou resposta não-JSON");
  }

  const content = extractMessageContent(payload);
  if (!content) {
    throw new GroqResponseError("Groq não retornou conteúdo de mensagem");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new GroqResponseError("Conteúdo da IA não é JSON válido");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new GroqResponseError();
  }

  const variations = (parsed as { variations?: unknown }).variations;
  if (!Array.isArray(variations)) {
    throw new GroqResponseError("Campo 'variations' ausente ou não é array");
  }

  const cleaned = variations
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim())
    .slice(0, safeCount);

  if (cleaned.length === 0) {
    throw new GroqResponseError("Nenhuma variação válida retornada");
  }

  return cleaned;
}

function extractMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}
