/**
 * ROGA-74 (Fase 4 de ROGA-49) — middleware de auth + workspace claim.
 *
 * Responsabilidades:
 *  1. Manter a sessao Supabase fresca via `@supabase/ssr` (refresh de
 *     tokens em cookies httpOnly).
 *  2. Em rotas autenticadas (`/api/*` excluindo rotas publicas), exigir
 *     que o JWT contenha o claim `workspace_id`. Sem o claim, redireciona
 *     para `ROGA_ONBOARDING_PATH` (default `/onboarding/workspace`).
 *
 * Feature flag:
 *   O redirecionamento para a tela de onboarding so e ativado quando
 *   `process.env.ROGA_REQUIRE_WORKSPACE_CLAIM === "1"`. Isso permite
 *   pousar o middleware sem quebrar fluxos legados ate que a Fase 5
 *   (UI/onboarding) esteja em producao.
 *
 *   Quando a flag esta OFF, o middleware ainda roda — ele apenas
 *   refresha a sessao Supabase e segue. Isso e seguro porque a leitura
 *   de `workspace_id` no backend ja faz fallback para o workspace
 *   default via `getCurrentWorkspaceId()`.
 *
 * Rotas publicas:
 *   - Tudo em `/_next/*`, `/favicon.ico`, arquivos estaticos.
 *   - Rotas de webhook (`/api/leads/outscraper/webhook`) — auth propria.
 *   - Rotas de auth (`/login`, `/auth/*`).
 *
 * NAO escopo aqui: criar a tela `/onboarding/workspace` (Fase 5).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const ONBOARDING_PATH = process.env.ROGA_ONBOARDING_PATH ?? "/onboarding/workspace";
const REQUIRE_WORKSPACE_CLAIM = process.env.ROGA_REQUIRE_WORKSPACE_CLAIM === "1";

const PUBLIC_PREFIXES = [
  "/_next",
  "/favicon.ico",
  "/login",
  "/auth",
  "/api/leads/outscraper/webhook",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
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

function extractWorkspaceClaim(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const direct = payload["workspace_id"];
  if (typeof direct === "string" && UUID_RE.test(direct)) return direct;
  const appMeta = payload["app_metadata"];
  if (appMeta && typeof appMeta === "object") {
    const fromMeta = (appMeta as Record<string, unknown>)["workspace_id"];
    if (typeof fromMeta === "string" && UUID_RE.test(fromMeta)) return fromMeta;
  }
  const userMeta = payload["user_metadata"];
  if (userMeta && typeof userMeta === "object") {
    const fromUserMeta = (userMeta as Record<string, unknown>)["workspace_id"];
    if (typeof fromUserMeta === "string" && UUID_RE.test(fromUserMeta)) {
      return fromUserMeta;
    }
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Sempre deixa passar rotas publicas sem mexer na sessao para
  // minimizar work em assets estaticos.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Resposta inicial — sera mutada pelos handlers de cookie do
  // Supabase SSR para refrescar tokens, se necessario.
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Se o Supabase nao estiver configurado, nao temos como validar nada
  // — segue (compat com dev/teste local).
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;

  // Sem sessao: a propria UI/handler decide o que fazer (login, anon).
  // Nao redirecionamos aqui pra nao quebrar fluxos publicos atras de
  // `/api/*` que possam existir.
  if (!session?.access_token) {
    return response;
  }

  // Sessao presente: checamos o claim de workspace.
  const workspaceId = extractWorkspaceClaim(session.access_token);

  if (!workspaceId && REQUIRE_WORKSPACE_CLAIM) {
    // API: retorna 409 explicito em vez de redirect (cliente fetch
    // nao segue redirects HTML de forma util).
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "workspace_required",
          message:
            "Usuario autenticado nao possui workspace. Complete o onboarding.",
          onboarding_path: ONBOARDING_PATH,
        },
        { status: 409 },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = ONBOARDING_PATH;
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Excluir assets estaticos / _next; o middleware acima faz checagem
    // adicional de publicidade do path.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
