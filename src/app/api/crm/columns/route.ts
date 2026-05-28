// TODO(ROGA-49): usar getCurrentWorkspaceId() de "@/lib/server/workspace"
//   antes de filtrar/inserir em tabelas multi-tenant. Aguarda Fase 2
//   (FK workspace_id) + Fase 3 (RLS) para migrar de forma segura.
//   Ver ROGA-74 para o helper.
﻿import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
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

  const { data, error } = await supabaseAdmin
    .from("crm_columns")
    .insert({ name, order, color })
    .select("id,name,order,color,created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ column: data }, { status: 201 });
}