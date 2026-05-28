/**
 * crm_history helper — appendInboxMessageHistory.
 *
 * ROGA-52 (ROGA-36.2): defesa em profundidade do app — toda mensagem
 * (inbound ou outbound) cujo destino tenha um lead resolvido emite um
 * evento `inbox_message` em `crm_history`, indexado por
 * `source_message_id` (uuid, unique parcial — criado pela migration 011).
 *
 * Idempotência:
 *  - O unique parcial em `crm_history(source_message_id)` garante que
 *    rerodar o handler de inbound/outbound não cria duplicatas.
 *  - Esta função trata a violação como no-op (não loga como erro).
 *
 * Best-effort:
 *  - Falhas inesperadas (rede, RLS) são apenas logadas; o caller NUNCA
 *    deve bloquear envio/persistência da mensagem por causa de uma
 *    falha em history.
 */

import { supabaseAdmin } from "@/lib/server/supabase-admin";

export type InboxMessageDirection = "in" | "out";

export type AppendInboxMessageHistoryInput = {
  leadId: string;
  messageId: string;
  direction: InboxMessageDirection;
  whatsappAccountId?: string | null;
  preview: string | null;
  createdAt?: string | Date | null;
  metadata?: Record<string, unknown>;
};

/**
 * Códigos de erro do PostgreSQL que sinalizam "linha já existe" no
 * unique parcial `crm_history_source_message_id_uidx`. Tratamos como
 * no-op idempotente.
 */
const UNIQUE_VIOLATION = "23505";

/**
 * Insere um evento `inbox_message` em crm_history.
 *
 * Retorna `true` se a linha foi gravada (ou já existia idempotentemente),
 * `false` se falhou por algum motivo persistente (logado).
 */
export async function appendInboxMessageHistory(
  input: AppendInboxMessageHistoryInput
): Promise<boolean> {
  if (!input.leadId || !input.messageId) {
    return false;
  }
  if (input.direction !== "in" && input.direction !== "out") {
    return false;
  }

  const createdAtIso =
    input.createdAt instanceof Date
      ? input.createdAt.toISOString()
      : typeof input.createdAt === "string" && input.createdAt
        ? input.createdAt
        : new Date().toISOString();

  const metadata: Record<string, unknown> = {
    direction: input.direction,
    ...(input.metadata ?? {}),
  };

  const row: Record<string, unknown> = {
    lead_id: input.leadId,
    type: "inbox_message",
    message: input.preview ?? "",
    source_message_id: input.messageId,
    whatsapp_account_id: input.whatsappAccountId ?? null,
    metadata,
    created_at: createdAtIso,
  };

  const { error } = await supabaseAdmin.from("crm_history").insert(row);

  if (!error) return true;

  // PostgREST exposes the SQL state in `.code`; also accept the standard
  // PG SQLSTATE for unique_violation as a defensive fallback.
  const code = (error as { code?: string }).code ?? "";
  const message = error.message ?? "";
  const isUniqueViolation =
    code === UNIQUE_VIOLATION ||
    /duplicate key|crm_history_source_message_id_uidx/i.test(message);

  if (isUniqueViolation) {
    // No-op: o evento já foi gravado em uma execução anterior.
    return true;
  }

  console.error(
    `[crm-history] appendInboxMessageHistory failed (lead=${input.leadId}, message=${input.messageId}, direction=${input.direction}):`,
    message
  );
  return false;
}
