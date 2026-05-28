import { supabaseAdmin } from "@/lib/server/supabase-admin";

export type CrmLeadInput = {
  name: string;
  phone: string;
  email?: string | null;
  company?: string | null;
  origin?: string | null;
  status: string;
  tags?: string[];
  notes?: string | null;
  assigned_to?: string | null;
  whatsapp_account_id?: string | null;
};

export function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export function validateLeadInput(input: Partial<CrmLeadInput>, requireAll: boolean) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const phoneRaw = typeof input.phone === "string" ? input.phone.trim() : "";
  const status = typeof input.status === "string" ? input.status.trim() : "";

  if (requireAll) {
    if (!name) return "Nome é obrigatório";
    if (!phoneRaw) return "Telefone é obrigatório";
    if (!status) return "Status é obrigatório";
  }

  if (phoneRaw && normalizePhone(phoneRaw).length < 10) {
    return "Telefone inválido";
  }

  return null;
}

export async function appendCrmHistory(params: {
  lead_id: string;
  type: string;
  message: string;
  whatsapp_account_id?: string | null;
}) {
  const { error } = await supabaseAdmin.from("crm_history").insert(params);
  if (error) {
    console.error("Erro ao salvar crm_history:", error.message);
  }
}
