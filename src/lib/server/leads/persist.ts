import { bulkInsertLeads, type CampaignLeadInput, type LeadSource } from "../campaign-leads";
import type { NormalizedLead } from "./types";

/**
 * Persist a batch of normalized leads via the existing campaign_leads pipeline
 * (dedupe, blacklist filter, phone normalize). The provider becomes the
 * `source` column so we keep ToS attribution (ROGA-69 risk mitigation).
 */
export async function persistNormalizedLeads(
  leads: NormalizedLead[]
): Promise<{ inserted: number; duplicates: number; invalid: number; blacklisted: number }> {
  if (leads.length === 0) {
    return { inserted: 0, duplicates: 0, invalid: 0, blacklisted: 0 };
  }

  // Group by provider so we can stamp `source` per-row. In practice a single
  // webhook delivery is from one provider, so this is usually 1 group.
  const byProvider = new Map<NormalizedLead["source"], CampaignLeadInput[]>();
  for (const lead of leads) {
    if (!lead.phone) continue;
    const arr = byProvider.get(lead.source) ?? [];
    arr.push({
      name: lead.name || null,
      phone: lead.phone,
      company: lead.category || null,
      tags: lead.placeId ? [`place:${lead.placeId}`] : null,
    });
    byProvider.set(lead.source, arr);
  }

  const totals = { inserted: 0, duplicates: 0, invalid: 0, blacklisted: 0 };
  for (const [provider, batch] of byProvider) {
    const stats = await bulkInsertLeads({
      leads: batch,
      // The `source` column accepts the provider names after migration 014.
      source: provider as unknown as LeadSource,
    });
    totals.inserted += stats.inserted;
    totals.duplicates += stats.duplicates;
    totals.invalid += stats.invalid;
    totals.blacklisted += stats.blacklisted;
  }
  return totals;
}
