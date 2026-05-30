import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * ROGA-92 / ROGA-59 — handler-piloto migrado de `supabaseAdmin` (service-role)
 * para `createSupabaseServerClient` (cookie-bound, expõe `auth.uid()`).
 *
 * Pré-requisito: policy RLS em `crm_columns` permitindo SELECT/INSERT para
 * role `authenticated`. Veja `database/009_rls_policies_mvp.sql` (ROGA-92.1).
 * Sem a policy, este handler retorna `{ columns: [] }` em GET e 500 em POST.
 *
 * O middleware (src/middleware.ts) já garante 401 antes de chegar aqui — não
 * é preciso revalidar a sessão neste handler.
 */
export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_columns")
    .select("id,name,order,color,created_at")
    .order("order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ columns: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const order = Number.isFinite(body.order) ? Number(body.order) : null;
  const color = typeof body.color === "string" ? body.color : "#3b82f6";

  if (!name || order === null) {
    return NextResponse.json({ error: "Nome e ordem são obrigatórios" }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_columns")
    .insert({ name, order, color })
    .select("id,name,order,color,created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ column: data }, { status: 201 });
}
