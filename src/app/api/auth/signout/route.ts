import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/signout
 *
 * Invalidates the Supabase session and clears auth cookies. Returns 204 on
 * success; the client is expected to redirect to /login.
 */
export async function POST() {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  return new NextResponse(null, { status: 204 });
}
