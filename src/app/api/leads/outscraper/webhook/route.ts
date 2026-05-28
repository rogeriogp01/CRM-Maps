import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { mapOutscraperWebhook, type OutscraperWebhookBody } from "@/lib/server/leads/mapper";
import { persistNormalizedLeads } from "@/lib/server/leads/persist";
import { recordUsage } from "@/lib/server/leads/cost-guard";
import { verifyHmacSignature, verifyWebhookToken } from "@/lib/server/leads/webhook-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/leads/outscraper/webhook?token=...
 *
 * Outscraper async-mode callback. Validates the shared token (and optional
 * HMAC) before doing any work. On success:
 *   1. Updates `lead_jobs` to mark the job as completed.
 *   2. Maps the payload to normalized leads.
 *   3. Persists them via the existing campaign_leads pipeline (which dedupes
 *      against blacklist + existing leads).
 *   4. Records actual cost in `lead_usage` so the guard tracks reality.
 *
 * Idempotency: re-deliveries hit the existing campaign_leads unique constraint
 * (campaign_id, phone_normalized) and are silently dropped as duplicates.
 * For cost tracking, we de-dup on `request_id` so we don't double-charge
 * against the budget on retries.
 */
export async function POST(request: Request) {
  const t0 = Date.now();
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!verifyWebhookToken(token)) {
    console.warn("[outscraper/webhook] token rejected");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();
  if (!verifyHmacSignature(rawBody, request.headers.get("x-signature-256"))) {
    console.warn("[outscraper/webhook] HMAC signature rejected");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: OutscraperWebhookBody;
  try {
    body = JSON.parse(rawBody) as OutscraperWebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const requestId = body.id ?? null;
  const status = (body.status ?? "").toLowerCase();

  // Failure / non-success statuses still need to mark the job so it stops blocking dashboards.
  if (status && status !== "success" && status !== "completed" && status !== "finished") {
    await markJob(requestId, "failed", { error: body.status ?? "non-success status" });
    console.warn(`[outscraper/webhook] non-success status=${body.status} request=${requestId}`);
    return NextResponse.json({ ok: true, status: body.status });
  }

  // De-dup re-deliveries on cost tracking. The campaign_leads upsert is
  // already idempotent on (campaign_id, phone_normalized).
  const alreadyCounted = requestId
    ? await jobAlreadySucceeded(requestId)
    : false;

  const leads = mapOutscraperWebhook(body);
  const persistStats = await persistNormalizedLeads(leads);

  // Cost reconciliation: Outscraper's webhook payload doesn't carry an exact
  // line-item cost, but the receipt is in `getRequestArchive(request_id)`.
  // For the guard we estimate as `leads_received * COST_PER_LEAD_CENTS`.
  // Operators can reconcile monthly against the provider invoice.
  const perLeadCents = Number(process.env.OUTSCRAPER_COST_PER_LEAD_CENTS ?? "2");
  const incurredCents = alreadyCounted ? 0 : leads.length * perLeadCents;

  await recordUsage({
    provider: "outscraper",
    costCents: incurredCents,
    leadsCount: alreadyCounted ? 0 : leads.length,
    jobsCount: alreadyCounted ? 0 : 1,
    requestId,
  });

  await markJob(requestId, "succeeded", {
    cost_usd_cents: incurredCents,
    leads_received: leads.length,
    leads_persisted: persistStats.inserted,
  });

  const latencyMs = Date.now() - t0;
  console.log(
    `[outscraper/webhook] ok request=${requestId} received=${leads.length} ` +
      `persisted=${persistStats.inserted} duplicates=${persistStats.duplicates} ` +
      `blacklisted=${persistStats.blacklisted} cost_cents=${incurredCents} latency_ms=${latencyMs}`
  );

  return NextResponse.json({
    ok: true,
    requestId,
    leadsReceived: leads.length,
    persisted: persistStats,
    costCents: incurredCents,
  });
}

async function jobAlreadySucceeded(requestId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("lead_jobs")
    .select("status")
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) return false;
  return data?.status === "succeeded";
}

async function markJob(
  requestId: string | null,
  status: "succeeded" | "failed",
  patch: Record<string, unknown>
): Promise<void> {
  if (!requestId) return;
  try {
    await supabaseAdmin
      .from("lead_jobs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        ...patch,
      })
      .eq("request_id", requestId);
  } catch (err) {
    console.warn(`[outscraper/webhook] lead_jobs update failed: ${(err as Error).message}`);
  }
}
