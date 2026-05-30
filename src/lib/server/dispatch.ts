/**
 * Service de envio real via Baileys.
 *
 * dispatchOneLead() é o único ponto de saída de mensagens reais do MapDisparo.
 * Carrega o lead, renderiza o template com identidade do operador, escolhe
 * uma conta WhatsApp conectada (com fallback automático), envia via socket
 * Baileys, persiste status em campaign_leads e grava em message_dispatch_history.
 *
 * Pensado para ser chamado por:
 *  - POST /api/whatsapp/dispatch/send (loop client-driven)
 *  - workers futuros (cron, fila) — basta importar e chamar.
 */

import { supabaseAdmin } from "./supabase-admin";
import { getSystemSettings } from "./system-settings";
import { updateLeadDispatchStatus } from "./campaign-leads";
import { renderTemplate, type TemplateVars } from "@/lib/template";
import { isValidPhone, toJid } from "@/lib/phone";
import { getNextAvailableWhatsapp } from "@/lib/dispatch-rotation";
import { getSocket } from "@/lib/whatsapp-manager";
import { appendCrmHistory } from "@/lib/crm";

const SEND_TIMEOUT_MS = 15_000;
const MAX_ACCOUNT_ATTEMPTS = 3;

export type DispatchInput = {
  leadId: string;
  messageTemplate: string;
  variationIndex: number; // 0-based
  preferredAccountIds?: string[];
};

export type DispatchSuccess = {
  ok: true;
  accountId: string;
  accountName: string;
  renderedMessage: string;
  messageId: string | null;
};

export type DispatchFailure = {
  ok: false;
  error: string; // código curto: "LEAD_NOT_FOUND" | "INVALID_PHONE" | "BLACKLISTED" | "NO_ACCOUNT_AVAILABLE" | "SEND_FAILED"
  triedAccountIds: string[];
  finalError?: string; // mensagem humana, último erro do Baileys
};

export type DispatchResult = DispatchSuccess | DispatchFailure;

type LeadRow = {
  id: string;
  campaign_id: string;
  name: string | null;
  phone: string;
  phone_normalized: string;
  company: string | null;
};

async function loadLead(leadId: string): Promise<LeadRow | null> {
  const { data, error } = await supabaseAdmin
    .from("campaign_leads")
    .select("id, campaign_id, name, phone, phone_normalized, company")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) return null;
  return data as LeadRow;
}

async function isBlacklisted(phoneNormalized: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("phone_blacklist")
    .select("phone_normalized")
    .eq("phone_normalized", phoneNormalized)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(t);
        resolve(value);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

async function recordHistory(params: {
  contact_phone: string;
  whatsapp_account_id: string | null;
  message_used: string;
  status: "sent" | "failed";
  error: string | null;
}): Promise<void> {
  try {
    await supabaseAdmin.from("message_dispatch_history").insert(params);
  } catch (err) {
    console.error("[dispatch] history insert failed:", err);
  }
}

async function syncCrm(params: {
  phoneNormalized: string;
  renderedMessage: string;
  status: "sent" | "failed";
  error: string | null;
  accountId: string | null;
}): Promise<void> {
  try {
    const { data: leadRow } = await supabaseAdmin
      .from("crm_leads")
      .select("id")
      .eq("phone", params.phoneNormalized)
      .maybeSingle();

    if (!leadRow?.id) return;

    await supabaseAdmin
      .from("crm_leads")
      .update({
        last_interaction_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadRow.id);

    await appendCrmHistory({
      lead_id: leadRow.id,
      type: params.status === "sent" ? "dispatch_sent" : "dispatch_failed",
      message: `${params.renderedMessage}${params.error ? ` | erro: ${params.error}` : ""}`,
      whatsapp_account_id: params.accountId ?? undefined,
    });
  } catch (err) {
    console.error("[dispatch] crm sync failed:", err);
  }
}

export async function dispatchOneLead(input: DispatchInput): Promise<DispatchResult> {
  // 1) Carrega lead
  const lead = await loadLead(input.leadId);
  if (!lead) {
    return { ok: false, error: "LEAD_NOT_FOUND", triedAccountIds: [] };
  }

  // 2) Valida telefone
  if (!isValidPhone(lead.phone_normalized)) {
    await updateLeadDispatchStatus(lead.id, {
      status: "failed",
      error: "INVALID_PHONE",
      error_message: "Telefone inválido após normalização",
      variation_used: input.variationIndex + 1,
    }).catch(() => {});
    return { ok: false, error: "INVALID_PHONE", triedAccountIds: [] };
  }

  // 3) Blacklist
  if (await isBlacklisted(lead.phone_normalized)) {
    await updateLeadDispatchStatus(lead.id, {
      status: "skipped",
      error: "BLACKLISTED",
      error_message: "Telefone em blacklist",
      variation_used: input.variationIndex + 1,
    }).catch(() => {});
    return { ok: false, error: "BLACKLISTED", triedAccountIds: [] };
  }

  // 4) Carrega settings + renderiza template
  const settings = await getSystemSettings().catch(() => ({
    operator_name: null,
    operator_whatsapp: null,
    company_name: null,
    company_website: null,
  }));
  const vars: TemplateVars = {
    nome: lead.name,
    empresa: lead.company,
    telefone: lead.phone_normalized,
    endereco: null,
    meu_nome: settings.operator_name,
    meu_whatsapp: settings.operator_whatsapp,
    minha_empresa: settings.company_name,
    meu_site: settings.company_website,
  };
  const renderedMessage = renderTemplate(input.messageTemplate, vars).trim();

  if (renderedMessage === "") {
    await updateLeadDispatchStatus(lead.id, {
      status: "failed",
      error: "EMPTY_MESSAGE",
      error_message: "Template resolveu para mensagem vazia",
      variation_used: input.variationIndex + 1,
    }).catch(() => {});
    return { ok: false, error: "EMPTY_MESSAGE", triedAccountIds: [] };
  }

  // 5) Loop de tentativas de conta
  const jid = toJid(lead.phone_normalized);
  const triedAccountIds: string[] = [];
  let lastErrorMessage: string | null = null;

  for (let attempt = 0; attempt < MAX_ACCOUNT_ATTEMPTS; attempt += 1) {
    const account = await getNextAvailableWhatsapp(triedAccountIds).catch(
      (err: unknown) => {
        console.error("[dispatch] rotation error:", err);
        return null;
      }
    );

    if (!account) {
      if (triedAccountIds.length === 0) {
        await updateLeadDispatchStatus(lead.id, {
          status: "failed",
          error: "NO_ACCOUNT_AVAILABLE",
          error_message: "Nenhuma conta WhatsApp conectada disponível",
          variation_used: input.variationIndex + 1,
        }).catch(() => {});
        await recordHistory({
          contact_phone: lead.phone_normalized,
          whatsapp_account_id: null,
          message_used: renderedMessage,
          status: "failed",
          error: "NO_ACCOUNT_AVAILABLE",
        });
        await syncCrm({
          phoneNormalized: lead.phone_normalized,
          renderedMessage,
          status: "failed",
          error: "NO_ACCOUNT_AVAILABLE",
          accountId: null,
        });
        return { ok: false, error: "NO_ACCOUNT_AVAILABLE", triedAccountIds };
      }
      // já tentou alguma, mas esgotou — sai do loop pra cair no SEND_FAILED final
      break;
    }

    const sock = getSocket(account.id);
    if (!sock || typeof sock.sendMessage !== "function") {
      triedAccountIds.push(account.id);
      lastErrorMessage = `Conta ${account.name} sem socket ativo`;
      continue;
    }

    try {
      const sendResult = await withTimeout(
        sock.sendMessage(jid, { text: renderedMessage }),
        SEND_TIMEOUT_MS,
        `sendMessage(${account.name})`
      );

      const sendResultObj = sendResult as { key?: { id?: string } } | null | undefined;
      const messageId: string | null = sendResultObj?.key?.id ?? null;

      // Persiste sucesso
      await updateLeadDispatchStatus(lead.id, {
        status: "sent",
        account_used: account.id,
        dispatched_at: new Date().toISOString(),
        variation_used: input.variationIndex + 1,
        error: null,
        error_message: null,
      }).catch((err) => {
        console.error("[dispatch] updateLead sent failed:", err);
      });

      await recordHistory({
        contact_phone: lead.phone_normalized,
        whatsapp_account_id: account.id,
        message_used: renderedMessage,
        status: "sent",
        error: null,
      });

      await syncCrm({
        phoneNormalized: lead.phone_normalized,
        renderedMessage,
        status: "sent",
        error: null,
        accountId: account.id,
      });

      return {
        ok: true,
        accountId: account.id,
        accountName: account.name,
        renderedMessage,
        messageId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[dispatch] send via ${account.name} failed:`, msg);
      triedAccountIds.push(account.id);
      lastErrorMessage = msg;
      // tenta próxima conta
    }
  }

  // 6) Esgotou tentativas
  const finalError = lastErrorMessage ?? "Falha de envio sem mensagem";
  await updateLeadDispatchStatus(lead.id, {
    status: "failed",
    error: "SEND_FAILED",
    error_message: finalError,
    variation_used: input.variationIndex + 1,
  }).catch(() => {});

  await recordHistory({
    contact_phone: lead.phone_normalized,
    whatsapp_account_id: triedAccountIds[triedAccountIds.length - 1] ?? null,
    message_used: renderedMessage,
    status: "failed",
    error: finalError,
  });

  await syncCrm({
    phoneNormalized: lead.phone_normalized,
    renderedMessage,
    status: "failed",
    error: finalError,
    accountId: triedAccountIds[triedAccountIds.length - 1] ?? null,
  });

  return {
    ok: false,
    error: "SEND_FAILED",
    triedAccountIds,
    finalError,
  };
}
