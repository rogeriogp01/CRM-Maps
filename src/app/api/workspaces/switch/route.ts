/**
 * ROGA-81 (Fase 5 de ROGA-49) — troca de workspace ativo.
 *
 * POST /api/workspaces/switch
 *   body: { workspace_id: string }
 *
 * Verifica que o requester e membro do workspace alvo (lookup em
 * `workspace_members`), e em caso afirmativo grava
 * `app_metadata.workspace_id` no usuario via Supabase Auth Admin API.
 *
 * O cliente DEVE, em seguida, chamar `supabase.auth.refreshSession()`
 * para forcar o reemissao do JWT com o novo claim. Sem esse refresh,
 * o claim antigo ainda esta valido ate o proximo refresh natural.
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin, assertAdminTask } from "@/lib/server/supabase-admin";
import { maybeSetWorkspaceClaim } from "../route";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
          // intentionally no-op
        },
        remove() {
          // intentionally no-op
        },
      },
    },
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    workspace_id?: unknown;
  };
  const targetId =
    typeof body.workspace_id === "string" ? body.workspace_id.trim() : "";

  if (!targetId || !UUID_RE.test(targetId)) {
    return NextResponse.json(
      { error: "invalid_workspace_id" },
      { status: 400 },
    );
  }

  const supabase = await getServerSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401 },
    );
  }
  const userId = userData.user.id;

  // Confirma que o usuario eh membro do workspace alvo. Sem esse check,
  // qualquer um poderia setar o claim para outro workspace.
  assertAdminTask(
    "POST /api/workspaces/switch: verificar membership antes de gravar claim",
  );

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .eq("workspace_id", targetId)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json(
      { error: "lookup_failed", message: membershipError.message },
      { status: 500 },
    );
  }

  if (!membership) {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "Usuario nao eh membro do workspace alvo",
      },
      { status: 403 },
    );
  }

  const result = await maybeSetWorkspaceClaim({
    userId,
    workspaceId: targetId,
    onlyIfMissing: false,
  });

  if (result.reason === "unavailable") {
    return NextResponse.json(
      {
        error: "claim_update_unavailable",
        message:
          "Auth Admin API indisponivel; o claim nao pode ser persistido nesta instancia.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    workspace_id: targetId,
    role: membership.role,
  });
}
