/**
 * LeadSource contract — provider-agnostic interface for acquiring leads.
 *
 * Consumers (API routes, jobs) MUST depend only on this interface. The concrete
 * provider (Outscraper today, possibly Places API later) is selected via the
 * LEAD_SOURCE env flag in `./factory`. This is what lets us swap providers
 * without refactoring the consumer pipeline (ROGA-69 scope item 1).
 *
 * Outscraper is asynchronous — `search()` enqueues a job and returns a job
 * descriptor. The webhook receiver finalizes results by calling
 * `persistFromWebhook()` (or whatever the adapter exposes on its async path).
 * Playwright is synchronous — `search()` itself streams/returns results.
 *
 * The shared `NormalizedLead` shape isolates downstream code from provider
 * payload differences.
 */

export type LeadProvider = "outscraper" | "playwright" | "places_api";

export interface NormalizedLead {
  name: string;
  /** Raw phone as the provider returned it. Normalization happens at persist time. */
  phone: string;
  address: string | null;
  category: string | null;
  rating: number | null;
  /** Google Place ID when available; used for cross-provider dedup. */
  placeId: string | null;
  /** Provider that produced this lead. Stamped on every persisted row for audit. */
  source: LeadProvider;
}

export interface LeadSearchInput {
  /** Free-text query (e.g. "padaria"). */
  query: string;
  /**
   * Region/locality string (e.g. "São Paulo, SP"). NOTE: this field does
   * double-duty for Outscraper today — it is appended to the query for
   * locality context AND interpreted as an ISO-3166-1 alpha-2 country code
   * if it happens to be 2 letters (otherwise defaults to "br"). Callers
   * passing things like "SP" thinking they mean the state will get
   * country-level Brazil. To override the country hint explicitly, set
   * `regionCode`.
   */
  region: string;
  /** Optional ISO-3166-1 alpha-2 country code override (e.g. "br", "us"). */
  regionCode?: string;
  /** Hard cap on number of leads to fetch. */
  limit: number;
  /** Optional language hint for the provider. Defaults to "pt" / "br". */
  language?: string;
  /**
   * Target campaign for the leads delivered by this search. Persisted on the
   * `lead_jobs` row at submit time and looked up by the webhook so leads land
   * on the right campaign (rather than always falling through to
   * `DEFAULT_CAMPAIGN_ID`). Omit to use the default campaign.
   */
  campaignId?: string;
}

/**
 * Returned by async providers (Outscraper). The job is in flight and results
 * will arrive via webhook. `requestId` is the provider's correlation id.
 */
export interface AsyncJobHandle {
  kind: "async";
  provider: LeadProvider;
  requestId: string;
  jobId: string;
  /** Estimated cost in USD cents that this job will incur if it completes. */
  estimatedCostCents: number;
}

/**
 * Returned by sync providers (Playwright). Results are already collected.
 */
export interface SyncResult {
  kind: "sync";
  provider: LeadProvider;
  leads: NormalizedLead[];
}

export type LeadSearchResult = AsyncJobHandle | SyncResult;

export interface LeadSource {
  readonly provider: LeadProvider;
  /**
   * Submit a search. Throws if the monthly cost guard would be exceeded.
   *
   * Async providers return an `AsyncJobHandle`; the caller MUST exit and wait
   * for the webhook to deliver results (do NOT poll inside the HTTP handler).
   * Sync providers return collected `NormalizedLead`s.
   */
  search(input: LeadSearchInput): Promise<LeadSearchResult>;
}

/**
 * Error thrown when the monthly cost guard would be exceeded by submitting
 * this job. Surfaced as 429 to the caller, logged at warn level with the
 * current spend and the configured ceiling.
 */
export class CostGuardExceededError extends Error {
  constructor(
    public readonly provider: LeadProvider,
    public readonly spentCents: number,
    public readonly estimatedCents: number,
    public readonly limitCents: number
  ) {
    super(
      `Cost guard tripped for ${provider}: spent=$${(spentCents / 100).toFixed(2)} + ` +
        `estimated=$${(estimatedCents / 100).toFixed(2)} > limit=$${(limitCents / 100).toFixed(2)}`
    );
    this.name = "CostGuardExceededError";
  }
}
