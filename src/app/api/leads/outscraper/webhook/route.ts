import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { mapOutscraperWebhook, type OutscraperWebhookBody } from "@/lib/server/leads/mapper";
import { persistNormalizedLeads } from "@/lib/server/leads/persist";
import { releaseReservation, settleReservation } from "@/lib/server/leads/cost-guard";
import { verifyHmacSignature, verifyWebhookToken } from "@/lib/server/leads/webhook-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/leads/outscraper/webhook?token=...
 *
 * Outscraper async-mode callback. Validates the shared token (and optional
 * HMAC) before doing any work. On success:
 *   1. Looks up the originating lead_jobs row by request_id to get the
 *      campaign_id, reserved budget, and per-lead price snapshotted at submit.
 *      Using the snapshot (instead of re-reading the env) keeps the
 *      reservation accounting honest across env rotations.
 *   2. Maps the payload to normalized leads.
 *   3. Persists them on the correct campaign via the existing
 *      campaign_leads pipeline (which dedupes against blacklist + existing).
 *   4. Settles the reservation: subtract the reserved amount, add the
 *      actually-incurred cost. On non-success status: release the reservation
 *      without recording cost.
 *
 * Idempotency: re-deliveries hit the existing campaign_leads unique constraint
 * (campaign_id, phone_normalized) and are silently dropped as duplicates.
 * For cost tracking, we de-dup on `request_id` so we don't double-settle.
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

  // Look up the lead_jobs row so we know which campaign these leads belong
  // to and what we reserved at submit. Defensive defaults if the row is
  // missing (out-of-order webhook / lost insert) keep us correct rather than
  // failing hard — leads still land on the default campaign with a warning.
  const job = requestId ? await loadJob(requestId) : null;
  const campaignId = job?.campaign_id ?? undefined;
  const reservedCents = job?.reserved_cost_usd_cents ?? 0;
  // Snapshot, NOT re-read of the env: keeps the bill matching the reservation
  // across key rotations / pricing changes between submit and webhook.
  const perLeadCents =
    job?.cost_per_lead_cents ?? Number(process.env.OUTSCRAPER_COST_PER_LEAD_CENTS ?? "2");

  // Failure / non-success statuses still need to release the reservation and
  // mark the job so it stops blocking dashboards.
  if (status && status !== "success" && status !== "completed" && status !== "finished") {
    if (reservedCents > 0) {
      try {
        await releaseReservation({ provider: "outscraper", reservedCents, requestId });
      } catch (err) {
        console.warn(`[outscraper/webhook] release failed: ${(err as Error).message}`);
      }
    }
    await markJob(requestId, "failed", { error: body.status ?? "non-success status" });
    console.warn(`[outscraper/webhook] non-success status=${body.status} request=${requestId}`);
    return NextResponse.json({ ok: true, status: body.status });
  }

  // De-dup re-deliveries on settlement. The campaign_leads upsert is already
  // idempotent on (campaign_id, phone_normalized).
  const alreadyCounted = job?.status === "succeeded";

  const leads = mapOutscraperWebhook(body);
  const persistStats = await persistNormalizedLeads(leads, { campaignId });

  // Cost reconciliation: Outscraper's webhook payload doesn't carry an exact
  // line-item cost, but the receipt is in `getRequestArchive(request_id)`.
  // For the guard we estimate as `leads_received * cost_per_lead_cents`.
  // Operators can reconcile monthly against the provider invoice.
  const incurredCents = alreadyCounted ? 0 : leads.length * perLeadCents;

  if (!alreadyCounted) {
    // Settle (or just record incurred, if no reservation row was found —
    // e.g. out-of-order delivery). Budget protection degrades to
    // best-effort in that one case but the next reserve call sees the cost.
    await settleReservation({
      provider: "outscraper",
      reservedCents,
      incurredCents,
      leadsCount: leads.length,
      requestId,
    });
  }

  await markJob(requestId, "succeeded", {
    cost_usd_cents: incurredCents,
    leads_received: leads.length,
    leads_persisted: persistStats.inserted,
  });

  const latencyMs = Date.now() - t0;
  console.log(
    `[outscraper/webhook] ok request=${requestId} campaign=${campaignId ?? "default"} ` +
      `received=${leads.length} persisted=${persistStats.inserted} ` +
      `duplicates=${persistStats.duplicates} blacklisted=${persistStats.blacklisted} ` +
      `reserved_cents=${reservedCents} incurred_cents=${incurredCents} latency_ms=${latencyMs}`
  );

  return NextResponse.json({
    ok: true,
    requestId,
    campaignId: campaignId ?? null,
    leadsReceived: leads.length,
    persisted: persistStats,
    costCents: incurredCents,
  });
}

interface LeadJobRow {
  campaign_id: string | null;
  reserved_cost_usd_cents: number | null;
  cost_per_lead_cents: number | null;
  status: string | null;
}

async function loadJob(requestId: string): Promise<LeadJobRow | null> {
  const { data, error } = await supabaseAdmin
    .from("lead_jobs")
    .select("campaign_id, reserved_cost_usd_cents, cost_per_lead_cents, status")
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) {
    console.warn(`[outscraper/webhook] lead_jobs lookup failed: ${error.message}`);
    return null;
  }
  return (data as LeadJobRow | null) ?? null;
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
