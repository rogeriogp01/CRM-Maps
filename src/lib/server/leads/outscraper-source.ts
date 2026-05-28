/* eslint-disable @typescript-eslint/no-explicit-any */
// The outscraper SDK uses CJS `export =`. With `esModuleInterop` we import the
// default export and reference both the class and its instance type through it.
import Outscraper from "outscraper";
import { reserveBudget, releaseReservation, getConfiguredLimitCents } from "./cost-guard";
import { supabaseAdmin } from "../supabase-admin";
import {
  CostGuardExceededError,
  type AsyncJobHandle,
  type LeadSearchInput,
  type LeadSearchResult,
  type LeadSource,
} from "./types";

type OutscraperClient = InstanceType<typeof Outscraper>;

/**
 * Outscraper-backed LeadSource. Submits Google Maps Search jobs in **async**
 * mode with a webhook callback so the HTTP request that triggered the search
 * returns immediately. The actual results flow into
 * `/api/leads/outscraper/webhook`.
 *
 * Cost model (per Outscraper pricing, May 2026):
 *   Google Maps Search v3 ≈ $0.014 per lead returned. We estimate
 *   `limit * COST_PER_LEAD_CENTS` up front and atomically reserve that amount
 *   via `lead_usage_reserve`. After the webhook arrives we settle the
 *   reservation against the actual lead count. On failure we release.
 *
 * The SDK's `googleMapsSearch` helper does NOT expose `webhook` — we drop one
 * level down to `getAPIRequest` which forwards arbitrary params.
 */

const COST_PER_LEAD_CENTS = Number(process.env.OUTSCRAPER_COST_PER_LEAD_CENTS ?? "2");

export interface OutscraperLeadSourceOpts {
  apiKey?: string;
  webhookUrl?: string;
  /** Injectable for tests. */
  client?: Pick<OutscraperClient, "getAPIRequest">;
  costPerLeadCents?: number;
}

export class OutscraperLeadSource implements LeadSource {
  readonly provider = "outscraper" as const;
  private readonly client: Pick<OutscraperClient, "getAPIRequest">;
  private readonly webhookUrl: string;
  private readonly costPerLeadCents: number;

  constructor(opts: OutscraperLeadSourceOpts = {}) {
    const apiKey = opts.apiKey ?? process.env.OUTSCRAPER_API_KEY;
    if (!opts.client && !apiKey) {
      throw new Error("OUTSCRAPER_API_KEY is required to construct OutscraperLeadSource");
    }
    this.client = opts.client ?? new Outscraper(apiKey!);
    this.webhookUrl =
      opts.webhookUrl ?? process.env.OUTSCRAPER_WEBHOOK_URL ?? "";
    if (!this.webhookUrl) {
      throw new Error(
        "OUTSCRAPER_WEBHOOK_URL is required (public URL of /api/leads/outscraper/webhook with ?token=...)"
      );
    }
    this.costPerLeadCents = opts.costPerLeadCents ?? COST_PER_LEAD_CENTS;
  }

  async search(input: LeadSearchInput): Promise<LeadSearchResult> {
    const limit = Math.max(1, Math.floor(input.limit));
    const estimatedCostCents = limit * this.costPerLeadCents;

    // 1. Atomic reserve — single RPC asserts cost+reserved+estimated <= limit
    //    and bumps reserved_cents. Eliminates the check-then-submit race.
    let yearMonth = "";
    try {
      const reserved = await reserveBudget({
        provider: "outscraper",
        estimatedCostCents,
      });
      yearMonth = reserved.yearMonth;
    } catch (err) {
      if (err instanceof CostGuardExceededError) {
        // Audit even denied-by-guard searches so the lead_jobs table reflects
        // every submit attempt (the migration has `rejected_by_guard` enum
        // value for exactly this).
        await this.recordRejectedByGuard(input, limit, estimatedCostCents, err.message);
      }
      throw err;
    }

    // 2. Submit async job with webhook. Mirror the SDK's googleMapsSearchV3
    //    payload shape but add `webhook` so Outscraper POSTs us when done.
    const fullQuery = input.region ? `${input.query} ${input.region}` : input.query;
    let response: any;
    try {
      response = await this.client.getAPIRequest("/maps/search-v3", {
        query: [fullQuery],
        language: input.language ?? "pt",
        region: regionCode(input.regionCode ?? input.region),
        organizationsPerQueryLimit: limit,
        skipPlaces: 0,
        dropDuplicates: true,
        enrichment: null,
        async: true,
        webhook: this.webhookUrl,
      });
    } catch (err) {
      // Submit failed before Outscraper accepted the job → release the
      // reservation so we don't leak budget.
      await safeRelease("outscraper", estimatedCostCents, null);
      throw err;
    }

    if (!response || response.error || response.errorMessage) {
      const msg =
        response?.error ??
        response?.errorMessage ??
        "Outscraper returned no response";
      await safeRelease("outscraper", estimatedCostCents, null);
      throw new Error(`Outscraper submit failed: ${msg}`);
    }

    const requestId = response.id ?? response.request_id ?? response.requestId;
    if (!requestId) {
      await safeRelease("outscraper", estimatedCostCents, null);
      throw new Error(`Outscraper response missing job id: ${JSON.stringify(response)}`);
    }

    // 3. Audit row so the webhook can correlate later. We snapshot the
    //    per-lead cost AND campaign_id here so a key rotation / pricing
    //    change / campaign reassignment between submit and webhook does
    //    not desync state.
    try {
      await supabaseAdmin.from("lead_jobs").insert({
        provider: "outscraper",
        request_id: requestId,
        campaign_id: input.campaignId ?? null,
        query: input.query,
        region: input.region,
        requested_limit: limit,
        reserved_cost_usd_cents: estimatedCostCents,
        cost_per_lead_cents: this.costPerLeadCents,
        status: "submitted",
      });
    } catch (err) {
      console.warn(`[outscraper] lead_jobs insert failed (continuing): ${(err as Error).message}`);
    }

    // Silence the no-unused-var lint after refactor; future code uses
    // yearMonth to attach the reservation timestamp to logs.
    void yearMonth;

    const handle: AsyncJobHandle = {
      kind: "async",
      provider: "outscraper",
      requestId,
      jobId: requestId,
      estimatedCostCents,
    };
    return handle;
  }

  /**
   * Insert a `rejected_by_guard` row so denied submits remain audit-visible
   * (closes should-fix #9 in the architectural review).
   */
  private async recordRejectedByGuard(
    input: LeadSearchInput,
    limit: number,
    estimatedCostCents: number,
    errorMessage: string,
  ): Promise<void> {
    try {
      await supabaseAdmin.from("lead_jobs").insert({
        provider: "outscraper",
        // no request_id — the job was never submitted to Outscraper.
        campaign_id: input.campaignId ?? null,
        query: input.query,
        region: input.region,
        requested_limit: limit,
        reserved_cost_usd_cents: 0,
        cost_per_lead_cents: this.costPerLeadCents,
        status: "rejected_by_guard",
        error: errorMessage.slice(0, 500),
        completed_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(
        `[outscraper] lead_jobs rejected_by_guard insert failed: ${(err as Error).message}`,
      );
    }
    // Silence ts-unused-var on estimatedCostCents (kept in signature for logs).
    void estimatedCostCents;
  }
}

/**
 * Outscraper accepts ISO-3166-1 alpha-2 region codes, not free-text region
 * names. If the input region happens to already be a 2-letter code we pass it
 * through; otherwise we default to "br" (the product is BR-first).
 */
function regionCode(region: string | undefined): string {
  if (region && /^[a-zA-Z]{2}$/.test(region.trim())) return region.trim().toLowerCase();
  return "br";
}

/** Best-effort release on submit-time failure. Errors are swallowed because
 *  the caller is already in an error path; surfacing two errors hides the real one. */
async function safeRelease(
  provider: "outscraper" | "playwright" | "places_api",
  reservedCents: number,
  requestId: string | null,
) {
  try {
    await releaseReservation({ provider, reservedCents, requestId });
  } catch (err) {
    console.warn(
      `[outscraper] reservation release failed (will be reclaimed by sweeper): ${(err as Error).message}`,
    );
  }
}

// Keep the import warning quiet for tests that mock the limit env.
void getConfiguredLimitCents;
