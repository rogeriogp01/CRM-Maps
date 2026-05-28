// TODO(ROGA-49): usar getCurrentWorkspaceId() de "@/lib/server/workspace"
//   antes de filtrar/inserir em tabelas multi-tenant. Aguarda Fase 2
//   (FK workspace_id) + Fase 3 (RLS) para migrar de forma segura.
//   Ver ROGA-74 para o helper.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/inbox/conversations/[id]/read
 *
 * Marca conversa como lida internamente: zera unread_count.
 * NÃO envia read receipt para o WhatsApp (fora de escopo v1).
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const { error } = await supabaseAdmin
    .from("chat_conversations")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}