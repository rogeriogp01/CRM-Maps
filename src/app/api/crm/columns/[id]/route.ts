import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (Number.isFinite(body.order)) patch.order = Number(body.order);
  if (typeof body.color === "string") patch.color = body.color;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("crm_columns")
    .update(patch)
    .eq("id", id)
    .select("id,name,order,color,created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ column: data });
}

export async function DELETE(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const { data: column, error: fetchError } = await supabaseAdmin
    .from("crm_columns")
    .select("id,name")
    .eq("id", id)
    .single();

  if (fetchError || !column) {
    return NextResponse.json({ error: "Coluna não encontrada" }, { status: 404 });
  }

  if (["Novo Lead", "Primeiro Contato", "Respondeu", "Interessado", "Negociacao", "Fechado", "Perdido"].includes(column.name)) {
    return NextResponse.json({ error: "Coluna padrão não pode ser removida" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("crm_columns").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
