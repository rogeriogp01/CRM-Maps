/**
 * ROGA-74 (Fase 4 de ROGA-49) — derivação server-side de `workspace_id`.
 *
 * Esse modulo centraliza a forma de obter o `workspace_id` da requisicao.
 * REGRA: handlers de rota NUNCA devem aceitar `workspace_id` vindo do
 * `req.body`, `searchParams` ou de path params. Sempre derivar do JWT do
 * usuario autenticado via `getCurrentWorkspaceId(request)`.
 *
 * Modelo de claim:
 *   O JWT do Supabase carrega `workspace_id` como custom claim
 *   (mesmo nome usado pela funcao SQL `public.current_workspace_id()` em
 *   `database/014_create_workspaces.sql`). A migration 014 ja lida com
 *   a leitura no lado do Postgres; este modulo replica a leitura no
 *   lado da aplicacao para handlers que usam `supabaseAdmin` (service
 *   role, que bypassa RLS) ou que precisam do id antes de qualquer query.
 *
 * Fallback:
 *   Quando nao ha sessao Supabase (dev, cron, jobs internos), retornamos
 *   o workspace default `00000000-0000-0000-0000-000000000001` — mesmo
 *   comportamento da funcao SQL — para nao quebrar fluxos legados
 *   durante a migracao incremental para multi-tenant. Esse fallback
 *   so e aplicado quando `allowFallback` e true (default), que e o
 *   comportamento atual para compat com a Fase 2. Quando o claim
 *   tornar-se mandatorio (apos Fase 5), o caller pode passar
 *   `allowFallback: false` para forcar 401/403 em handlers protegidos.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const DEFAULT_WORKSPACE_ID =
  "00000000-0000-0000-0000-000000000001" as const;

export class WorkspaceNotFoundError extends Error {
  readonly code = "WORKSPACE_NOT_FOUND";
  constructor(message = "workspace_id claim ausente no JWT") {
    super(message);
    this.name = "WorkspaceNotFoundError";
  }
}

export interface WorkspaceContext {
  workspaceId: string;
  /** true quando o id veio do fallback de dev (sem JWT ou sem claim). */
  isFallback: boolean;
  /** subject (user id) do JWT, se disponivel. */
  userId: string | null;
}

interface ResolveOptions {
  /**
   * Se `false`, lanca `WorkspaceNotFoundError` quando nao ha claim no JWT.
   * Default `true` (mantem compat com handlers legados durante a migracao).
   */
  allowFallback?: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Decodifica o payload de um JWT (apenas a parte do meio, sem validar
 * assinatura). A validacao real e feita pelo Supabase via cookies;
 * aqui so precisamos ler os custom claims. NUNCA confie nesse payload
 * para autorizacao sem que ele tenha vindo de uma sessao Supabase
 * verificada por `getUser()` / `auth-helpers`.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    // base64url -> base64
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Cria um Supabase client server-side com cookies, do mesmo modo que
 * `@supabase/ssr` recomenda para Route Handlers / Server Actions.
 */
async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // route handlers / server components nao escrevem cookies aqui;
        // o middleware cuida do refresh. Mantemos no-ops para satisfazer
        // a interface do `createServerClient`.
        set() {
          // intentionally no-op
        },
        remove() {
          // intentionally no-op
        },
      },
    },
  );
}

interface ResolvedClaims {
  workspaceId: string | null;
  userId: string | null;
  hasSession: boolean;
}

async function resolveClaimsFromSession(): Promise<ResolvedClaims> {
  const supabase = await getServerSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;

  if (!session?.access_token) {
    return { workspaceId: null, userId: null, hasSession: false };
  }

  const payload = decodeJwtPayload(session.access_token);
  if (!payload) {
    return { workspaceId: null, userId: session.user?.id ?? null, hasSession: true };
  }

  // 1) custom claim direto no token
  const direct = payload["workspace_id"];
  if (isUuid(direct)) {
    return {
      workspaceId: direct,
      userId: (payload["sub"] as string | undefined) ?? session.user?.id ?? null,
      hasSession: true,
    };
  }

  // 2) app_metadata.workspace_id (padrao quando claim e setado via
  //    `auth.users.raw_app_meta_data` no Supabase).
  const appMeta = payload["app_metadata"];
  if (appMeta && typeof appMeta === "object") {
    const fromMeta = (appMeta as Record<string, unknown>)["workspace_id"];
    if (isUuid(fromMeta)) {
      return {
        workspaceId: fromMeta,
        userId: (payload["sub"] as string | undefined) ?? session.user?.id ?? null,
        hasSession: true,
      };
    }
  }

  // 3) user_metadata.workspace_id (fallback — nao recomendado para
  //    autorizacao, mas suportado em ambientes legados).
  const userMeta = payload["user_metadata"];
  if (userMeta && typeof userMeta === "object") {
    const fromUserMeta = (userMeta as Record<string, unknown>)["workspace_id"];
    if (isUuid(fromUserMeta)) {
      return {
        workspaceId: fromUserMeta,
        userId: (payload["sub"] as string | undefined) ?? session.user?.id ?? null,
        hasSession: true,
      };
    }
  }

  return {
    workspaceId: null,
    userId: (payload["sub"] as string | undefined) ?? session.user?.id ?? null,
    hasSession: true,
  };
}

/**
 * Retorna o `workspace_id` derivado do JWT da sessao Supabase.
 *
 * - Quando ha sessao valida com claim `workspace_id` em formato UUID:
 *   retorna esse id.
 * - Quando nao ha sessao (dev, cron, requests sem cookie):
 *   retorna o workspace default se `allowFallback !== false`.
 * - Quando ha sessao mas o claim esta ausente/invalido:
 *   - se `allowFallback === true` (default): retorna default.
 *   - se `allowFallback === false`: lanca `WorkspaceNotFoundError`.
 *
 * IMPORTANTE: o parametro `_request` existe apenas para deixar
 * explicito no callsite que a derivacao depende da requisicao
 * corrente (cookies). A leitura real e feita via `next/headers`
 * `cookies()`, que so funciona dentro do contexto de uma request.
 */
export async function getCurrentWorkspaceId(
  _request?: Request,
  options: ResolveOptions = {},
): Promise<string> {
  const ctx = await getWorkspaceContext(_request, options);
  return ctx.workspaceId;
}

/**
 * Versao "rica" que devolve `workspace_id`, `userId` e se a resolucao
 * caiu no fallback. Util para logging / auditoria nos handlers.
 */
export async function getWorkspaceContext(
  _request?: Request,
  options: ResolveOptions = {},
): Promise<WorkspaceContext> {
  const allowFallback = options.allowFallback ?? true;
  const { workspaceId, userId, hasSession } = await resolveClaimsFromSession();

  if (workspaceId) {
    return { workspaceId, isFallback: false, userId };
  }

  if (allowFallback) {
    return { workspaceId: DEFAULT_WORKSPACE_ID, isFallback: true, userId };
  }

  // sem fallback: distinguimos "sem sessao" de "sessao sem claim"
  if (!hasSession) {
    throw new WorkspaceNotFoundError(
      "Nenhuma sessao Supabase ativa para esta requisicao",
    );
  }
  throw new WorkspaceNotFoundError(
    "Sessao autenticada nao contem o claim 'workspace_id'",
  );
}

/**
 * Retorna um Supabase client server-side ja vinculado a sessao do
 * usuario (RLS valida automaticamente porque o cookie do Supabase
 * carrega o JWT), junto com o `workspace_id` derivado.
 *
 * Use quando o handler depende de RLS para isolar dados — o cliente
 * retornado roda como o usuario autenticado, nao como service role.
 *
 * Para queries que precisam bypassar RLS (jobs, cron, admin), continue
 * usando `supabaseAdmin` + `withWorkspace(workspaceId, fn)` (ver
 * `supabase-admin.ts`).
 */
export async function getSupabaseWithWorkspace(
  request?: Request,
  options: ResolveOptions = {},
) {
  const supabase = await getServerSupabase();
  const context = await getWorkspaceContext(request, options);
  return { supabase, ...context };
}
