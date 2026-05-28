// TODO(ROGA-49): usar getCurrentWorkspaceId() de "@/lib/server/workspace"
//   antes de filtrar/inserir em tabelas multi-tenant. Aguarda Fase 2
//   (FK workspace_id) + Fase 3 (RLS) para migrar de forma segura.
//   Ver ROGA-74 para o helper.
﻿import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import {
  disconnectWhatsAppAccount,
  removeWhatsAppSessionFiles,
} from "@/lib/whatsapp-manager";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const { data: account, error: fetchError } = await supabaseAdmin
    .from("whatsapp_accounts")
    .select("id,session_id")
    .eq("id", id)
    .single();

  if (fetchError || !account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  await disconnectWhatsAppAccount(account.id);
  removeWhatsAppSessionFiles(account.session_id);

  const { error } = await supabaseAdmin.from("whatsapp_accounts").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}