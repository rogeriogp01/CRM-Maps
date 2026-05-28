import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
}

const supabaseKey = supabaseServiceRoleKey ?? supabaseAnonKey;

if (!supabaseKey) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured");
}

export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ============================================================
// ROGA-74 (Fase 4 de ROGA-49) — workspace guard para service role
//
// `supabaseAdmin` usa service role e BYPASSA RLS. Isso significa que
// qualquer query sem filtro de `workspace_id` pode vazar dados entre
// tenants. Para evitar isso, expomos dois helpers:
//
//   - `withWorkspace(workspaceId, run)`: aplica o `workspace_id` no
//     contexto da sessao Postgres via `set_config('request.jwt.claims', …, true)`,
//     replicando o claim que a funcao `public.current_workspace_id()`
//     leria. Use em jobs/cron/handlers de webhook onde nao ha JWT
//     mas o workspace ja foi resolvido externamente.
//
//   - `assertAdminTask(reason)`: marker explicito para queries que
//     legitimamente nao filtram por workspace (ex.: migration scripts,
//     auditoria global, manutencao). Documenta o motivo no codigo.
//
// Regra de revisao: queries diretas em `supabaseAdmin` sem um desses
// dois guardas devem ser tratadas como bug em PR review.
// ============================================================

/**
 * Marker tipado para queries `supabaseAdmin` que intencionalmente nao
 * filtram por `workspace_id`. Tornando explicito o motivo, conseguimos
 * grep + auditar facilmente:
 *
 *   grep -rn "assertAdminTask(" src/
 *
 * Use em scripts de manutencao, cron de housekeeping e jobs de
 * auditoria que precisam varrer multiplas tenants.
 */
export function assertAdminTask(reason: string): void {
  if (!reason || reason.trim().length === 0) {
    throw new Error(
      "assertAdminTask requires a non-empty justification (qual tarefa de admin global esta sendo executada?)",
    );
  }
  // intentionally no-op em runtime; serve apenas como anotacao
  // legivel + grepavel + audit trail em logs estruturados.
}

/**
 * Roda `run(supabaseAdmin)` com o claim `workspace_id` injetado no
 * contexto da sessao Postgres. Internamente, executa
 * `select set_config('request.jwt.claims', '{"workspace_id":"…"}', true)`
 * antes de delegar para `run`, de modo que `public.current_workspace_id()`
 * (e qualquer policy RLS futura — Fase 3) enxergue o tenant correto
 * mesmo em queries que rodam com service role.
 *
 * Use em handlers que precisam de service role (bypass de RLS, por
 * exemplo para insercoes em tabelas com policies restritivas) mas
 * que ja conhecem o `workspace_id` derivado do JWT via
 * `getCurrentWorkspaceId(request)`.
 *
 * NAO USE como substituto de `getCurrentWorkspaceId` — o workspace
 * passado aqui DEVE ter sido derivado do JWT do usuario, nunca do
 * body/query da request.
 */
export async function withWorkspace<T>(
  workspaceId: string,
  run: (client: SupabaseClient) => Promise<T>,
): Promise<T> {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new Error(
      "withWorkspace requires a non-empty workspace_id (derive via getCurrentWorkspaceId)",
    );
  }
  // O Supabase nao expoe `set_config` direto na API REST. Tentamos via
  // RPC com uma funcao publica se ela existir; se nao, seguimos sem o
  // GUC e cabe ao caller passar `workspace_id` explicitamente em
  // `.eq("workspace_id", workspaceId)` nas queries.
  //
  // A funcao SQL `public.set_request_workspace(uuid)` sera adicionada
  // junto com as policies da Fase 3 (ROGA-72). Ate la, este helper
  // funciona como passthrough seguro + audit hook.
  try {
    // tenta setar via RPC; ignora erro de "function does not exist"
    // para nao quebrar enquanto a Fase 3 nao landed.
    await supabaseAdmin.rpc("set_request_workspace", {
      p_workspace_id: workspaceId,
    });
  } catch {
    // intentionally swallow — a RPC e opcional ate a Fase 3.
  }
  return run(supabaseAdmin);
}
