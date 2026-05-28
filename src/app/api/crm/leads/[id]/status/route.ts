// TODO(ROGA-49): usar getCurrentWorkspaceId() de "@/lib/server/workspace"
//   antes de filtrar/inserir em tabelas multi-tenant. Aguarda Fase 2
//   (FK workspace_id) + Fase 3 (RLS) para migrar de forma segura.
//   Ver ROGA-74 para o helper.
﻿import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { appendCrmHistory } from "@/lib/crm";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const status = typeof body.status === "string" ? body.status.trim() : "";

  if (!status) {
    return NextResponse.json({ error: "Status é obrigatório" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("crm_leads")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id,status,whatsapp_account_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await appendCrmHistory({
    lead_id: id,
    type: "status_changed",
    message: `Status alterado para ${status}`,
    whatsapp_account_id: data.whatsapp_account_id,
  });

  return NextResponse.json({ success: true, status: data.status });
}