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

export async function GET(_: Request, { params }: RouteParams) {
  const { id } = await params;

  const { data: account, error } = await supabaseAdmin
    .from("whatsapp_accounts")
    .select("id,session_id,status")
    .eq("id", id)
    .single();

  if (error || !account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  await connectWhatsAppAccount(account);

  const timeoutMs = 15000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const live = getWhatsAppLiveState(id);

    if (live?.qr) {
      return NextResponse.json({ qr: live.qr, status: live.status, error: null });
    }

    if (live?.status === "connected") {
      return NextResponse.json({ qr: null, status: "connected", error: null });
    }

    if (live?.status === "error") {
      return NextResponse.json({ qr: null, status: "error", error: live.lastError ?? "Falha ao conectar" }, { status: 500 });
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return NextResponse.json({
    error: "QR Code não disponível no momento. Tente novamente.",
    status: "connecting",
  }, { status: 504 });
}