import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client bound to the current request's cookies.
 * Use inside Route Handlers, Server Components, and Server Actions.
 *
 * Authenticated requests will expose `auth.uid()` to Postgres / RLS.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // In Route Handlers cookies() is writable. In Server Components it isn't;
          // swallow the error there — middleware already refreshed the session.
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // no-op (RSC)
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // no-op (RSC)
          }
        },
      },
    },
  );
}

/**
 * Returns the authenticated user for the current request, or null.
 * Use at the top of a Route Handler:
 *
 *   const { user, supabase } = await requireUser();
 *   if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
 */
export async function getSessionUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { user, supabase };
}
