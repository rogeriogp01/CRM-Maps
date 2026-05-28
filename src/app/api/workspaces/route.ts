/**
 * ROGA-81 (Fase 5 de ROGA-49) — endpoints de workspaces.
 *
 * GET  /api/workspaces            — lista workspaces do usuario autenticado
 *                                   (junta `workspaces` x `workspace_members`).
 * POST /api/workspaces            — cria um novo workspace, insere o
 *                                   requester como `owner` em `workspace_members`
 *                                   e persiste o claim `workspace_id` no
 *                                   `app_metadata` do usuario (reemissao de JWT
 *                                   ocorre via `supabase.auth.refreshSession()`
 *                                   no cliente, ou no proximo refresh natural).
 *
 * NUNCA aceitamos `workspace_id` ou `user_id` do body — o owner e sempre
 * o `auth.uid()` da sessao. Respeita a regra da Fase 4 (ROGA-74).
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin, assertAdminTask } from "@/lib/server/supabase-admin";

const VALID_PLANS = new Set(["free", "pro", "enterprise"] as const);
type Plan = "free" | "pro" | "enterprise";

interface WorkspaceMembership {
  workspace_id: string;
  role: "owner" | "admin" | "member";
  workspaces: {
    id: string;
    name: string;
    plan: Plan;
    owner_user_id: string;
    created_at: string;
    updated_at: string;
  } | null;
}

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
          // intentionally no-op (route handler context)
        },
        remove() {
          // intentionally no-op (route handler context)
        },
      },
    },
  );
}

async function requireUserId(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await getServerSupabase();
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "unauthenticated", message: "Sessao Supabase ausente ou invalida" },
        { status: 401 },
      ),
    };
  }
  return { ok: true, userId: userData.user.id };
}

// ---------------------------------------------------------------------------
// GET /api/workspaces
// ---------------------------------------------------------------------------
export async function GET() {
  const auth = await requireUserId();
  if (!auth.ok) return auth.response;

  // Query intencionalmente cross-workspace: precisamos listar TODOS os
  // workspaces dos quais o usuario faz parte. Marcado para auditoria.
  assertAdminTask("GET /api/workspaces: listar memberships do usuario autenticado");

  const { data, error } = await supabaseAdmin
    .from("workspace_members")
    .select(
      "workspace_id, role, workspaces:workspaces!inner ( id, name, plan, owner_user_id, created_at, updated_at )",
    )
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "query_failed", message: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as unknown as WorkspaceMembership[];
  const workspaces = rows
    .map((row) => {
      const ws = row.workspaces;
      if (!ws) return null;
      return {
        id: ws.id,
        name: ws.name,
        plan: ws.plan,
        owner_user_id: ws.owner_user_id,
        created_at: ws.created_at,
        updated_at: ws.updated_at,
        role: row.role,
      };
    })
    .filter((w): w is NonNullable<typeof w> => w !== null);

  return NextResponse.json({ workspaces });
}

// ---------------------------------------------------------------------------
// POST /api/workspaces
// ---------------------------------------------------------------------------
interface CreateWorkspaceBody {
  name?: unknown;
  plan?: unknown;
}

function validateCreate(body: CreateWorkspaceBody):
  | { ok: true; name: string; plan: Plan }
  | { ok: false; error: string } {
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    return { ok: false, error: "name eh obrigatorio" };
  }
  if (rawName.length > 80) {
    return { ok: false, error: "name deve ter no maximo 80 caracteres" };
  }

  const rawPlan = typeof body.plan === "string" ? body.plan.trim() : "free";
  if (!VALID_PLANS.has(rawPlan as Plan)) {
    return {
      ok: false,
      error: `plan invalido (${rawPlan}); use 'free', 'pro' ou 'enterprise'`,
    };
  }

  return { ok: true, name: rawName, plan: rawPlan as Plan };
}

export async function POST(request: Request) {
  const auth = await requireUserId();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as CreateWorkspaceBody;
  const validated = validateCreate(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  // 1) Cria o workspace.
  //    `assertAdminTask`: usamos service role porque a tabela ainda nao tem
  //    RLS e (mesmo quando tiver) o INSERT precisa do user_id como
  //    owner_user_id, derivado do JWT pelo proprio handler.
  assertAdminTask(
    "POST /api/workspaces: insert em workspaces + workspace_members com owner_user_id derivado do JWT",
  );

  const { data: workspace, error: insertWsError } = await supabaseAdmin
    .from("workspaces")
    .insert({
      name: validated.name,
      plan: validated.plan,
      owner_user_id: auth.userId,
    })
    .select("id, name, plan, owner_user_id, created_at, updated_at")
    .single();

  if (insertWsError || !workspace) {
    return NextResponse.json(
      {
        error: "workspace_create_failed",
        message: insertWsError?.message ?? "Falha ao criar workspace",
      },
      { status: 500 },
    );
  }

  // 2) Insere o requester como owner em workspace_members.
  const { error: memberError } = await supabaseAdmin
    .from("workspace_members")
    .insert({
      workspace_id: workspace.id,
      user_id: auth.userId,
      role: "owner",
    });

  if (memberError) {
    // Tenta rollback do workspace para nao deixar lixo.
    await supabaseAdmin.from("workspaces").delete().eq("id", workspace.id);
    return NextResponse.json(
      {
        error: "membership_create_failed",
        message: memberError.message,
      },
      { status: 500 },
    );
  }

  // 3) Reemite o claim `workspace_id` no app_metadata do usuario.
  //    Quando esse for o PRIMEIRO workspace do usuario (onboarding), tambem
  //    "ativa" ele como current. Quando for o N-esimo, mantemos o atual a
  //    menos que o cliente chame /api/workspaces/switch.
  //
  //    NOTA: app_metadata so e gravavel via service role (admin API). O JWT
  //    so refresca o claim no proximo `refreshSession()` no cliente — a UI
  //    chama isso explicitamente apos POST.
  const updateClaim = await maybeSetWorkspaceClaim({
    userId: auth.userId,
    workspaceId: workspace.id,
    onlyIfMissing: true,
  });

  return NextResponse.json(
    {
      workspace: { ...workspace, role: "owner" as const },
      claim: updateClaim,
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// Helpers de claim (compartilhados com /api/workspaces/switch)
// ---------------------------------------------------------------------------

interface ClaimUpdateResult {
  updated: boolean;
  reason: "set" | "kept_existing" | "unavailable";
  workspace_id?: string;
}

/**
 * Tenta gravar `workspace_id` em `app_metadata` do usuario. Quando
 * `onlyIfMissing` for true, so grava se ainda nao houver claim. Util no
 * onboarding (primeiro workspace) para nao sobrescrever sessao ativa.
 *
 * Em ambientes onde a Auth Admin API nao esta disponivel (sem
 * SUPABASE_SERVICE_ROLE_KEY, dev local sem Supabase real, etc.), retorna
 * `{ updated: false, reason: "unavailable" }` sem lancar — o caller pode
 * exibir um aviso ao usuario mas o workspace ainda foi criado.
 */
export async function maybeSetWorkspaceClaim(params: {
  userId: string;
  workspaceId: string;
  onlyIfMissing: boolean;
}): Promise<ClaimUpdateResult> {
  const { userId, workspaceId, onlyIfMissing } = params;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { updated: false, reason: "unavailable" };
  }

  try {
    if (onlyIfMissing) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      const meta = (data?.user?.app_metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.workspace_id === "string" && meta.workspace_id.length > 0) {
        return {
          updated: false,
          reason: "kept_existing",
          workspace_id: meta.workspace_id,
        };
      }
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      app_metadata: { workspace_id: workspaceId },
    });
    if (error) {
      return { updated: false, reason: "unavailable" };
    }
    return { updated: true, reason: "set", workspace_id: workspaceId };
  } catch {
    return { updated: false, reason: "unavailable" };
  }
}
