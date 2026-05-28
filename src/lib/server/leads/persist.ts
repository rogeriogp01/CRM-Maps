import { bulkInsertLeads, type CampaignLeadInput, type LeadSource } from "../campaign-leads";
import type { NormalizedLead } from "./types";

/**
 * Persist a batch of normalized leads via the existing campaign_leads pipeline
 * (dedupe, blacklist filter, phone normalize). The provider becomes the
 * `source` column so we keep ToS attribution (ROGA-69 risk mitigation).
 *
 * Carries the full NormalizedLead shape into campaign_leads: `address`,
 * `rating`, `category`, and `placeId` are persisted as distinct columns so
 * the LeadSource seam does not silently drop fields the interface promises.
 * (The original implementation collapsed category into `company` and dropped
 * address/rating entirely — fixed for the ROGA-69 architectural review.)
 *
 * `campaignId` MUST be threaded from the originating search via lead_jobs;
 * absent it, leads fall back to DEFAULT_CAMPAIGN_ID and an operator has to
 * move them manually.
 */
export async function persistNormalizedLeads(
  leads: NormalizedLead[],
  opts: { campaignId?: string } = {}
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
      // `company` is reserved for the legal/display name. The provider's
      // category (e.g. "padaria") goes in the dedicated `category` column —
      // collapsing them confuses downstream callers that expect legal names.
      company: null,
      tags: lead.placeId ? [`place:${lead.placeId}`] : null,
      address: lead.address,
      rating: lead.rating,
      category: lead.category,
      placeId: lead.placeId,
    });
    byProvider.set(lead.source, arr);
  }

  const totals = { inserted: 0, duplicates: 0, invalid: 0, blacklisted: 0 };
  for (const [provider, batch] of byProvider) {
    const stats = await bulkInsertLeads({
      leads: batch,
      // The `source` column accepts the provider names after migration 014.
      source: provider as unknown as LeadSource,
      campaignId: opts.campaignId,
    });
    totals.inserted += stats.inserted;
    totals.duplicates += stats.duplicates;
    totals.invalid += stats.invalid;
    totals.blacklisted += stats.blacklisted;
  }
  return totals;
}
