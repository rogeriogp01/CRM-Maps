import type {
  LeadSearchInput,
  LeadSearchResult,
  LeadSource,
  SyncResult,
} from "./types";

/**
 * Playwright fallback LeadSource. Intentionally a thin pointer to the
 * existing /api/extractor implementation — we are NOT duplicating that code.
 * When LEAD_SOURCE=playwright is set, the routing layer calls into the
 * existing `/api/extractor` flow instead of going through this adapter.
 *
 * This class exists so callers that depend on the LeadSource interface have
 * a uniform handle when the flag flips, and so we can later inline the logic
 * here (and delete /api/extractor) without touching consumers.
 */
export class PlaywrightLeadSource implements LeadSource {
  readonly provider = "playwright" as const;

  async search(_input: LeadSearchInput): Promise<LeadSearchResult> {
    // Deliberately not implemented in-process — the existing /api/extractor
    // streams over HTTP. The factory exposes a metadata flag so the route can
    // delegate to that endpoint. If a non-route caller invokes this directly
    // they'll get a clear error pointing at the right place.
    throw new Error(
      "PlaywrightLeadSource.search() is not callable in-process — " +
        "the legacy Playwright extractor is exposed via POST /api/extractor (streaming NDJSON). " +
        "Set LEAD_SOURCE=outscraper to use the async LeadSource interface."
    );
  }
}

/** Returned by the factory so the route can know whether to delegate. */
export interface PlaywrightFallbackHandle {
  kind: "delegate-to-legacy-route";
  route: "/api/extractor";
}

export function playwrightFallbackHandle(): SyncResult & PlaywrightFallbackHandle {
  // Cast satisfies both interfaces — the router checks `kind` first.
  return {
    kind: "delegate-to-legacy-route",
    route: "/api/extractor",
    provider: "playwright",
    leads: [],
  } as unknown as SyncResult & PlaywrightFallbackHandle;
}
