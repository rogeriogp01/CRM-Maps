// TODO(ROGA-49): usar getCurrentWorkspaceId() de "@/lib/server/workspace"
//   antes de filtrar/inserir em tabelas multi-tenant. Aguarda Fase 2
//   (FK workspace_id) + Fase 3 (RLS) para migrar de forma segura.
//   Ver ROGA-74 para o helper.
﻿import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import {
  connectWhatsAppAccount,
  getWhatsAppLiveState,
} from "@/lib/whatsapp-manager";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const { data: account, error } = await supabaseAdmin
    .from("whatsapp_accounts")
    .select("id,session_id")
    .eq("id", id)
    .single();

  if (error || !account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  await connectWhatsAppAccount(account);
  const live = getWhatsAppLiveState(id);

  return NextResponse.json({
    status: live?.status ?? "connecting",
    qr: live?.qr ?? null,
    error: live?.lastError ?? null,
  });
}