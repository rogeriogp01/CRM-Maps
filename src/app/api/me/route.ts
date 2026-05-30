import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";

/**
 * ROGA-92 / ROGA-89.3 — smoke endpoint para o E2E de autenticação canônica.
 *
 * Retorna a identidade do usuário autenticado pela sessão Supabase. O
 * middleware (`src/middleware.ts`) já 401-a chamadas anônimas, então um
 * `user === null` aqui só acontece se alguém remover o middleware.
 *
 * Útil também como "ping" do cliente para verificar se o cookie de sessão
 * ainda está válido após refresh do JWT.
 */
export async function GET() {
  const { user } = await getSessionUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // `workspace_id` virá do user metadata uma vez que ROGA-74 esteja em
  // produção; até lá expomos `null` para não vazar a tabela `workspaces`
  // de outros contextos. O smoke E2E só exige presença do campo.
  const workspaceId =
    (user.app_metadata as Record<string, unknown> | null)?.["workspace_id"] ??
    (user.user_metadata as Record<string, unknown> | null)?.["workspace_id"] ??
    null;

  return NextResponse.json({
    user_id: user.id,
    email: user.email ?? null,
    workspace_id: typeof workspaceId === "string" ? workspaceId : null,
  });
}
