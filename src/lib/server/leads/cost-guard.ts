import { supabaseAdmin } from "../supabase-admin";
import { CostGuardExceededError, type LeadProvider } from "./types";

/**
 * Persistent monthly cost guard. Reads accumulated `cost_usd_cents` for
 * (provider, current UTC month) from `lead_usage`. If
 * `spent + estimated > MAX_MONTHLY_LEAD_COST_USD` the guard trips and we
 * throw `CostGuardExceededError` — the adapter MUST surface this without
 * submitting the job (otherwise we burn budget then realize too late).
 *
 * Defaults are conservative ($50/mo per ROGA-69) so that a missing env var
 * caps us at the authorized board reserve rather than letting jobs flow freely.
 */

/**
 * Backend that reads the accumulated spend and writes increments. The default
 * implementation talks to Supabase via the `lead_usage` table + RPC.
 * Tests inject a stub.
 */
export interface UsageStore {
  getMonthlySpentCents(provider: LeadProvider, yearMonth: string): Promise<number>;
  increment(args: {
    provider: LeadProvider;
    yearMonth: string;
    costCents: number;
    leadsCount: number;
    jobsCount: number;
    requestId?: string | null;
  }): Promise<void>;
}

export function currentYearMonth(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function getConfiguredLimitCents(): number {
  const raw = process.env.MAX_MONTHLY_LEAD_COST_USD;
  if (!raw) return 5000; // $50.00 — ROGA-69 board reserve.
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars < 0) return 5000;
  return Math.round(dollars * 100);
}

/**
 * Throws CostGuardExceededError when `spent + estimated > limit`.
 * Otherwise resolves with the current spend (useful for logging/headers).
 */
export async function assertWithinBudget(args: {
  provider: LeadProvider;
  estimatedCostCents: number;
  store?: UsageStore;
  now?: Date;
  limitCents?: number;
}): Promise<{ spentCents: number; limitCents: number }> {
  const store = args.store ?? supabaseUsageStore();
  const yearMonth = currentYearMonth(args.now);
  const limitCents = args.limitCents ?? getConfiguredLimitCents();
  const spentCents = await store.getMonthlySpentCents(args.provider, yearMonth);

  if (spentCents + args.estimatedCostCents > limitCents) {
    throw new CostGuardExceededError(args.provider, spentCents, args.estimatedCostCents, limitCents);
  }
  return { spentCents, limitCents };
}

/**
 * Records cost actually incurred (post-result, called by the webhook handler
 * after we know the real lead count and provider-reported cost).
 */
export async function recordUsage(args: {
  provider: LeadProvider;
  costCents: number;
  leadsCount: number;
  jobsCount?: number;
  requestId?: string | null;
  store?: UsageStore;
  now?: Date;
}): Promise<void> {
  const store = args.store ?? supabaseUsageStore();
  await store.increment({
    provider: args.provider,
    yearMonth: currentYearMonth(args.now),
    costCents: args.costCents,
    leadsCount: args.leadsCount,
    jobsCount: args.jobsCount ?? 1,
    requestId: args.requestId ?? null,
  });
}

/**
 * Real Supabase-backed store. Lazy so the module imports cleanly in tests
 * that never call it (no Supabase env required).
 */
let _supabaseStore: UsageStore | null = null;
export function supabaseUsageStore(): UsageStore {
  if (_supabaseStore) return _supabaseStore;
  _supabaseStore = {
    async getMonthlySpentCents(provider, yearMonth) {
      const { data, error } = await supabaseAdmin
        .from("lead_usage")
        .select("cost_usd_cents")
        .eq("provider", provider)
        .eq("year_month", yearMonth)
        .maybeSingle();
      if (error) throw new Error(`lead_usage read failed: ${error.message}`);
      return data?.cost_usd_cents ?? 0;
    },
    async increment({ provider, yearMonth, costCents, leadsCount, jobsCount, requestId }) {
      const { error } = await supabaseAdmin.rpc("lead_usage_increment", {
        p_provider: provider,
        p_year_month: yearMonth,
        p_cost_cents: costCents,
        p_leads_count: leadsCount,
        p_jobs_count: jobsCount,
        p_request_id: requestId,
      });
      if (error) throw new Error(`lead_usage_increment failed: ${error.message}`);
    },
  };
  return _supabaseStore;
}

/** Test seam: reset memoized supabase store. */
export function __resetSupabaseStore() {
  _supabaseStore = null;
}
