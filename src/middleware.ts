import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Public routes (no auth required). Everything else under the matcher below
 * is gated — unauthenticated users are redirected to /login (HTML routes) or
 * receive 401 (api routes).
 */
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/api/auth", // /api/auth/callback, /api/auth/signout, etc.
];

/**
 * System endpoints that intentionally do not require an interactive user
 * session — they are called by background workers, webhooks, or external
 * services and must remain reachable.
 *
 * Keep this list small and justified. Each entry should map to a system
 * actor, not a user action.
 */
const SYSTEM_API_PREFIXES = [
  // Baileys callbacks/health probes from the WhatsApp manager run inside
  // the server process; they use service-role internally and do not carry
  // a user cookie.
  "/api/whatsapp/connect",
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  if (SYSTEM_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always refresh the session cookie so SSR + Route Handlers see a fresh JWT.
  const { response, user } = await updateSession(request);

  if (isPublicPath(pathname)) {
    // Already authenticated user hitting /login → bounce to dashboard.
    if (user && (pathname === "/login" || pathname.startsWith("/login/"))) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!user) {
    // API routes: respond 401 JSON instead of redirecting.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: response.headers },
      );
    }

    // HTML routes: redirect to /login, preserving original destination.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/" && pathname !== "/dashboard") {
      url.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  /**
   * Run on every request EXCEPT Next internals and common public assets.
   * The handler itself decides whether the path is public.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
