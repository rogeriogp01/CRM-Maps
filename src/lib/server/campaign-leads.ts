import { supabaseAdmin } from "./supabase-admin";
import { normalizePhone, isValidPhone } from "@/lib/phone";

export const DEFAULT_CAMPAIGN_ID = "00000000-0000-0000-0000-000000000001";

// Mirror of campaign_leads.source CHECK constraint (see migration 014).
// `outscraper` and `playwright` were added when the LeadSource interface
// landed so we can stamp provider attribution on every row.
export type LeadSource = "crm" | "maps" | "csv" | "manual" | "outscraper" | "playwright";

export type CampaignLeadInput = {
  name?: string | null;
  phone: string;
  company?: string | null;
  tags?: string[] | null;
  /** Postal address as the provider returned it. */
  address?: string | null;
  /** Place rating (0–5). */
  rating?: number | null;
  /** Place category (e.g. "padaria") — distinct from `company` (legal name). */
  category?: string | null;
  /** Google Place ID for cross-provider dedup. */
  placeId?: string | null;
};

export type CampaignLeadRow = {
  id: string;
  campaign_id: string;
  name: string | null;
  phone: string;
  phone_normalized: string;
  company: string | null;
  tags: string[] | null;
  address: string | null;
  rating: number | null;
  category: string | null;
  place_id: string | null;
  source: LeadSource;
  valid_whatsapp: boolean | null;
  already_contacted: boolean;
  last_contacted_at: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  account_used: string | null;
  variation_used: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type BulkInsertResult = {
  inserted: number;
  duplicates: number;
  invalid: number;
  blacklisted: number;
};

async function getBlacklistedSet(
  phonesNormalized: string[]
): Promise<Set<string>> {
  if (phonesNormalized.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from("phone_blacklist")
    .select("phone_normalized")
    .in("phone_normalized", phonesNormalized);
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.phone_normalized as string));
}

export async function bulkInsertLeads(params: {
  leads: CampaignLeadInput[];
  source: LeadSource;
  campaignId?: string;
}): Promise<BulkInsertResult> {
  const campaignId = params.campaignId ?? DEFAULT_CAMPAIGN_ID;

  // Normaliza + filtra inválidos.
  type Pre = CampaignLeadInput & { _norm: string };
  const pre: Pre[] = [];
  let invalid = 0;
  for (const lead of params.leads) {
    if (!isValidPhone(lead.phone)) {
      invalid += 1;
      continue;
    }
    pre.push({ ...lead, _norm: normalizePhone(lead.phone) });
  }

  // Dedup dentro do batch atual (por _norm).
  const dedupedMap = new Map<string, Pre>();
  for (const p of pre) {
    if (!dedupedMap.has(p._norm)) dedupedMap.set(p._norm, p);
  }
  const deduped = Array.from(dedupedMap.values());
  const intraBatchDuplicates = pre.length - deduped.length;

  // Filtra blacklist.
  const blacklisted = await getBlacklistedSet(deduped.map((p) => p._norm));
  const afterBlacklist = deduped.filter((p) => !blacklisted.has(p._norm));
  const blacklistedCount = deduped.length - afterBlacklist.length;

  if (afterBlacklist.length === 0) {
    return {
      inserted: 0,
      duplicates: intraBatchDuplicates,
      invalid,
      blacklisted: blacklistedCount,
    };
  }

  const rows = afterBlacklist.map((p) => ({
    campaign_id: campaignId,
    name: p.name ?? null,
    phone: p.phone,
    phone_normalized: p._norm,
    company: p.company ?? null,
    tags: p.tags ?? null,
    address: p.address ?? null,
    rating: p.rating ?? null,
    category: p.category ?? null,
    place_id: p.placeId ?? null,
    source: params.source,
  }));

  // upsert por (campaign_id, phone_normalized).
  const { data, error } = await supabaseAdmin
    .from("campaign_leads")
    .upsert(rows, {
      onConflict: "campaign_id,phone_normalized",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  const inserted = data?.length ?? 0;
  const duplicatesVsExisting = afterBlacklist.length - inserted;

  return {
    inserted,
    duplicates: intraBatchDuplicates + duplicatesVsExisting,
    invalid,
    blacklisted: blacklistedCount,
  };
}

export async function listLeads(params: {
  campaignId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ leads: CampaignLeadRow[]; total: number }> {
  const campaignId = params.campaignId ?? DEFAULT_CAMPAIGN_ID;
  const limit = Math.min(params.limit ?? 500, 2000);
  const offset = params.offset ?? 0;

  let query = supabaseAdmin
    .from("campaign_leads")
    .select("*", { count: "exact" })
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.status) {
    query = query.eq("status", params.status);
  }

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  return {
    leads: (data ?? []) as CampaignLeadRow[],
    total: count ?? 0,
  };
}

export async function deleteLeads(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { error, count } = await supabaseAdmin
    .from("campaign_leads")
    .delete({ count: "exact" })
    .in("id", ids);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function deleteAllLeads(
  campaignId: string = DEFAULT_CAMPAIGN_ID
): Promise<number> {
  const { error, count } = await supabaseAdmin
    .from("campaign_leads")
    .delete({ count: "exact" })
    .eq("campaign_id", campaignId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function markValidWhatsApp(
  ids: string[],
  isValid: boolean
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin
    .from("campaign_leads")
    .update({ valid_whatsapp: isValid, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(error.message);
}

/**
 * Atualiza status pós-disparo de UM lead. Usado pelo service de envio real
 * (src/lib/server/dispatch.ts) após cada tentativa de sendMessage.
 */
export async function updateLeadDispatchStatus(
  leadId: string,
  patch: {
    status: "sent" | "failed" | "skipped";
    account_used?: string | null;
    dispatched_at?: string | null;
    variation_used?: number | null;
    error?: string | null;
    error_message?: string | null;
  }
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    status: patch.status,
    updated_at: new Date().toISOString(),
  };
  if (patch.account_used !== undefined) updatePayload.account_used = patch.account_used;
  if (patch.dispatched_at !== undefined) updatePayload.dispatched_at = patch.dispatched_at;
  if (patch.variation_used !== undefined) updatePayload.variation_used = patch.variation_used;
  if (patch.error !== undefined) updatePayload.error = patch.error;
  if (patch.error_message !== undefined) updatePayload.error_message = patch.error_message;

  const { error } = await supabaseAdmin
    .from("campaign_leads")
    .update(updatePayload)
    .eq("id", leadId);
  if (error) throw new Error(error.message);
}

export async function markAlreadyContacted(
  ids: string[],
  lastContactedAt: string | null,
  contacted: boolean
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabaseAdmin
    .from("campaign_leads")
    .update({
      already_contacted: contacted,
      last_contacted_at: lastContactedAt,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (error) throw new Error(error.message);
}
