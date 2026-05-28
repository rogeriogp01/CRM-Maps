/* eslint-disable @typescript-eslint/no-explicit-any */
// The outscraper SDK uses CJS `export =`. With `esModuleInterop` we import the
// default export and reference both the class and its instance type through it.
import Outscraper from "outscraper";
import { assertWithinBudget } from "./cost-guard";
import { supabaseAdmin } from "../supabase-admin";
import type {
  AsyncJobHandle,
  LeadSearchInput,
  LeadSearchResult,
  LeadSource,
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
 *   `limit * COST_PER_LEAD_CENTS` up front for the cost guard. After the
 *   webhook arrives we reconcile against the actual lead count.
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

    // 1. Cost guard — refuse to submit if we'd blow the monthly cap.
    await assertWithinBudget({
      provider: "outscraper",
      estimatedCostCents,
    });

    // 2. Submit async job with webhook. Mirror the SDK's googleMapsSearchV3
    //    payload shape but add `webhook` so Outscraper POSTs us when done.
    const fullQuery = input.region ? `${input.query} ${input.region}` : input.query;
    const response: any = await this.client.getAPIRequest("/maps/search-v3", {
      query: [fullQuery],
      language: input.language ?? "pt",
      region: regionCode(input.region),
      organizationsPerQueryLimit: limit,
      skipPlaces: 0,
      dropDuplicates: true,
      enrichment: null,
      async: true,
      webhook: this.webhookUrl,
    });

    if (!response || response.error || response.errorMessage) {
      const msg =
        response?.error ??
        response?.errorMessage ??
        "Outscraper returned no response";
      throw new Error(`Outscraper submit failed: ${msg}`);
    }

    const requestId = response.id ?? response.request_id ?? response.requestId;
    if (!requestId) {
      throw new Error(`Outscraper response missing job id: ${JSON.stringify(response)}`);
    }

    // 3. Audit row so the webhook can correlate later. Best-effort: a failed
    //    insert here would still surface the job via Outscraper's history API.
    try {
      await supabaseAdmin.from("lead_jobs").insert({
        provider: "outscraper",
        request_id: requestId,
        query: input.query,
        region: input.region,
        requested_limit: limit,
        status: "submitted",
      });
    } catch (err) {
      console.warn(`[outscraper] lead_jobs insert failed (continuing): ${(err as Error).message}`);
    }

    const handle: AsyncJobHandle = {
      kind: "async",
      provider: "outscraper",
      requestId,
      jobId: requestId,
      estimatedCostCents,
    };
    return handle;
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
