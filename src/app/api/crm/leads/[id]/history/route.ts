// TODO(ROGA-49): usar getCurrentWorkspaceId() de "@/lib/server/workspace"
//   antes de filtrar/inserir em tabelas multi-tenant. Aguarda Fase 2
//   (FK workspace_id) + Fase 3 (RLS) para migrar de forma segura.
//   Ver ROGA-74 para o helper.
﻿import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("crm_history")
    .select("id,lead_id,type,message,whatsapp_account_id,created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ history: data ?? [] });
}