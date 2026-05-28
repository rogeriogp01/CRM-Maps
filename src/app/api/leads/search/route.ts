import { NextResponse } from "next/server";
import { buildLeadSource, resolveLeadProvider } from "@/lib/server/leads/factory";
import { CostGuardExceededError } from "@/lib/server/leads/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/leads/search
 *
 * Provider-agnostic search trigger. Picks the configured LeadSource (Outscraper
 * by default), submits the job, and:
 *   - For async providers: returns { jobId } immediately (HTTP 202).
 *     Results arrive via /api/leads/outscraper/webhook.
 *   - For sync/legacy fallback (playwright): returns a 307 redirect to the
 *     existing /api/extractor streaming endpoint so the UI can be kept
 *     identical during rollback.
 *
 * Body: {
 *   query: string,
 *   region: string,
 *   limit?: number,
 *   language?: string,
 *   campaignId?: string,
 *   regionCode?: string,  // ISO-3166-1 alpha-2 country hint, overrides the
 *                         //   double-duty interpretation of `region`.
 * }
 */
export async function POST(request: Request) {
  let body: {
    query?: unknown;
    region?: unknown;
    limit?: unknown;
    language?: unknown;
    campaignId?: unknown;
    regionCode?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  if (typeof body.query !== "string" || body.query.trim() === "") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }
  if (typeof body.region !== "string" || body.region.trim() === "") {
    return NextResponse.json({ error: "region is required" }, { status: 400 });
  }

  const provider = resolveLeadProvider();

  if (provider === "playwright") {
    // Rollback path: hand off to the legacy streaming extractor without
    // changing the UI contract — same endpoint shape, just behind the flag.
    return NextResponse.json(
      {
        delegate: true,
        provider: "playwright",
        route: "/api/extractor",
        message:
          "LEAD_SOURCE=playwright is set — call POST /api/extractor with { query, location } to use the legacy scraper.",
      },
      { status: 200 }
    );
  }

  const source = buildLeadSource(provider);
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 500) : 100;

  try {
    const result = await source.search({
      query: body.query,
      region: body.region,
      limit,
      language: typeof body.language === "string" ? body.language : undefined,
      regionCode: typeof body.regionCode === "string" ? body.regionCode : undefined,
      campaignId: typeof body.campaignId === "string" ? body.campaignId : undefined,
    });

    if (result.kind === "async") {
      return NextResponse.json(
        {
          accepted: true,
          provider: result.provider,
          jobId: result.jobId,
          estimatedCostCents: result.estimatedCostCents,
        },
        { status: 202 }
      );
    }
    return NextResponse.json({ provider: result.provider, leads: result.leads });
  } catch (err) {
    if (err instanceof CostGuardExceededError) {
      console.warn(`[leads/search] cost guard tripped: ${err.message}`);
      return NextResponse.json(
        {
          error: "monthly_budget_exceeded",
          provider: err.provider,
          spentCents: err.spentCents,
          limitCents: err.limitCents,
        },
        { status: 429 }
      );
    }
    const message = err instanceof Error ? err.message : "internal error";
    console.error(`[leads/search] failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
