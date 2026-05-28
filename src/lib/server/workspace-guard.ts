/**
 * ROGA-81 (Fase 5 de ROGA-49) — guard de layout para "usuario sem workspace".
 *
 * Use em `app/(dashboard)/layout.tsx` (ou em qualquer layout/route handler
 * server-side que precise garantir que o usuario completou o onboarding):
 *
 *   await ensureUserHasWorkspace();
 *
 * Regras:
 *   1. Sem sessao Supabase ativa → no-op (caller decide login).
 *   2. Sessao + zero linhas em `workspace_members` para o user → redirect
 *      para `ROGA_ONBOARDING_PATH` (default `/onboarding/workspace`).
 *   3. Sessao + ao menos uma membership → no-op (segue para o app).
 *
 * Distincao em relacao ao middleware (ROGA-74):
 *   - O middleware checa se ha CLAIM no JWT (`workspace_id`). Quando a
 *     flag `ROGA_REQUIRE_WORKSPACE_CLAIM` esta OFF (default em dev),
 *     ele nao redireciona — para nao quebrar o app antes da Fase 5.
 *   - Este guard, em contraste, checa a verdade no banco. Mesmo sem a
 *     flag, se o usuario nao tem workspace algum, ele e redirecionado
 *     para o onboarding. O middleware continua sendo a fonte de
 *     redirect para usuarios com sessao mas sem claim no JWT (cenario
 *     pos-signup imediato antes do refresh).
 */

import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin, assertAdminTask } from "@/lib/server/supabase-admin";

const ONBOARDING_PATH =
  process.env.ROGA_ONBOARDING_PATH ?? "/onboarding/workspace";

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
        set() {
          // intentionally no-op (Server Component context)
        },
        remove() {
          // intentionally no-op (Server Component context)
        },
      },
    },
  );
}

export async function ensureUserHasWorkspace(): Promise<void> {
  // Em ambientes sem Supabase configurado (testes/dev local cego),
  // nao tentamos redirecionar — o middleware ja segura essa borda.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return;
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    // Sem sessao: o app continua, login/middleware decidem.
    return;
  }
  const userId = data.user.id;

  assertAdminTask(
    "ensureUserHasWorkspace: contar memberships do usuario autenticado para decidir redirect onboarding",
  );

  const { count, error: countError } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    // Em caso de erro de query, nao queremos redirecionar em loop —
    // deixamos passar e o middleware/handlers downstream decidem.
    return;
  }

  if ((count ?? 0) === 0) {
    redirect(ONBOARDING_PATH);
  }
}
