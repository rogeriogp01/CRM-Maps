import { NextResponse } from "next/server";
import { dispatchOneLead } from "@/lib/server/dispatch";

/**
 * POST /api/whatsapp/dispatch/send
 *
 * Dispara UMA mensagem real via Baileys. Pensado pra ser chamado pelo loop
 * do DisparoModule (client-driven), 1 chamada = 1 envio.
 *
 * Erros de negócio (sem conta, send falhou, lead inexistente) vêm como
 * 200 OK com { ok: false, error }. O cliente decide como exibir.
 * Só retorna 4xx/5xx em validação de input e crashes inesperados.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body JSON inválido" },
      { status: 400 }
    );
  }

  const b = (body ?? {}) as Record<string, unknown>;

  const leadId = typeof b.leadId === "string" ? b.leadId.trim() : "";
  const messageTemplate =
    typeof b.messageTemplate === "string" ? b.messageTemplate : "";
  const variationIndex =
    typeof b.variationIndex === "number" && Number.isFinite(b.variationIndex)
      ? Math.max(0, Math.floor(b.variationIndex))
      : 0;
  const preferredAccountIds = Array.isArray(b.preferredAccountIds)
    ? (b.preferredAccountIds as unknown[]).filter(
        (x): x is string => typeof x === "string"
      )
    : undefined;

  if (!leadId) {
    return NextResponse.json(
      { error: "leadId é obrigatório" },
      { status: 400 }
    );
  }
  if (!messageTemplate.trim()) {
    return NextResponse.json(
      { error: "messageTemplate é obrigatório" },
      { status: 400 }
    );
  }

  try {
    const result = await dispatchOneLead({
      leadId,
      messageTemplate,
      variationIndex,
      preferredAccountIds,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno";
    console.error("[dispatch/send] crash:", message);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR", finalError: message, triedAccountIds: [] },
      { status: 500 }
    );
  }
}
