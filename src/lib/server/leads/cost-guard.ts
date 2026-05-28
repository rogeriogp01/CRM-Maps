import { supabaseAdmin } from "../supabase-admin";
import { CostGuardExceededError, type LeadProvider } from "./types";

/**
 * Persistent monthly cost guard with atomic reserve / settle / release.
 *
 * Why reservations? The naive "read spent, then submit, then record usage at
 * webhook" pattern has a check-then-submit race: two concurrent submits both
 * see the same `spent`, both pass the limit check, both submit, and we burn
 * past the cap. To close that, every submit calls `reserveBudget` which
 * atomically asserts `cost + reserved + estimated <= limit` inside a single
 * UPDATE (RPC `lead_usage_reserve`). If the assert fails we throw
 * `CostGuardExceededError` without ever talking to the provider.
 *
 * At webhook time we call `settleReservation` to swap the reservation for the
 * actually-incurred cost. If a job fails or times out, `releaseReservation`
 * returns the held budget so we don't leak.
 *
 * Defaults stay at the board-authorized $50/mo (ROGA-69).
 */

/**
 * Backend that reads accumulated spend / performs reserve+settle. The default
 * implementation talks to Supabase via the `lead_usage` table + RPCs.
 * Tests inject a stub.
 */
export interface UsageStore {
  getMonthlySpentCents(provider: LeadProvider, yearMonth: string): Promise<number>;
  /**
   * Atomically reserve `estimatedCents` against the monthly cap.
   * Returns the new outstanding reservation total on success.
   * Throws `CostGuardExceededError` when the limit would be exceeded.
   */
  reserve(args: {
    provider: LeadProvider;
    yearMonth: string;
    estimatedCents: number;
    limitCents: number;
    requestId?: string | null;
  }): Promise<void>;
  /**
   * At webhook time: convert a reservation into actual cost.
   */
  settle(args: {
    provider: LeadProvider;
    yearMonth: string;
    reservedCents: number;
    incurredCents: number;
    leadsCount: number;
    jobsCount: number;
    requestId?: string | null;
  }): Promise<void>;
  /**
   * On job failure: release the reservation without recording cost so the
   * budget is not leaked against work that produced no leads.
   */
  release(args: {
    provider: LeadProvider;
    yearMonth: string;
    reservedCents: number;
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
 * Reserve budget for a single in-flight job. Atomic check-and-bump under the
 * `lead_usage_reserve` RPC: rejects if `cost + reserved + estimated > limit`.
 *
 * The webhook MUST call `settleReservation` (success) or `releaseReservation`
 * (failure) to keep `reserved_cents` from inflating forever.
 */
export async function reserveBudget(args: {
  provider: LeadProvider;
  estimatedCostCents: number;
  store?: UsageStore;
  now?: Date;
  limitCents?: number;
  requestId?: string | null;
}): Promise<{ limitCents: number; yearMonth: string }> {
  const store = args.store ?? supabaseUsageStore();
  const yearMonth = currentYearMonth(args.now);
  const limitCents = args.limitCents ?? getConfiguredLimitCents();

  try {
    await store.reserve({
      provider: args.provider,
      yearMonth,
      estimatedCents: args.estimatedCostCents,
      limitCents,
      requestId: args.requestId ?? null,
    });
  } catch (err) {
    if (err instanceof CostGuardExceededError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    // Surface the underlying budget-exceeded error from the RPC as the
    // application-level CostGuardExceededError so callers / HTTP layer
    // can map it to 429 uniformly.
    if (/budget_exceeded/i.test(message)) {
      const spent = await store.getMonthlySpentCents(args.provider, yearMonth);
      throw new CostGuardExceededError(args.provider, spent, args.estimatedCostCents, limitCents);
    }
    throw err;
  }
  return { limitCents, yearMonth };
}

/**
 * Settle a reservation made at submit-time. `reservedCents` is the amount that
 * was reserved (read it from the `lead_jobs` row); `incurredCents` is the
 * actually-billed amount for this job.
 */
export async function settleReservation(args: {
  provider: LeadProvider;
  reservedCents: number;
  incurredCents: number;
  leadsCount: number;
  jobsCount?: number;
  requestId?: string | null;
  store?: UsageStore;
  now?: Date;
}): Promise<void> {
  const store = args.store ?? supabaseUsageStore();
  await store.settle({
    provider: args.provider,
    yearMonth: currentYearMonth(args.now),
    reservedCents: args.reservedCents,
    incurredCents: args.incurredCents,
    leadsCount: args.leadsCount,
    jobsCount: args.jobsCount ?? 1,
    requestId: args.requestId ?? null,
  });
}

/**
 * Release a reservation without recording any cost. Use on failed / timed-out
 * jobs so the held budget returns to the pool.
 */
export async function releaseReservation(args: {
  provider: LeadProvider;
  reservedCents: number;
  requestId?: string | null;
  store?: UsageStore;
  now?: Date;
}): Promise<void> {
  if (args.reservedCents <= 0) return;
  const store = args.store ?? supabaseUsageStore();
  await store.release({
    provider: args.provider,
    yearMonth: currentYearMonth(args.now),
    reservedCents: args.reservedCents,
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
    async reserve({ provider, yearMonth, estimatedCents, limitCents, requestId }) {
      const { error } = await supabaseAdmin.rpc("lead_usage_reserve", {
        p_provider: provider,
        p_year_month: yearMonth,
        p_estimated_cents: estimatedCents,
        p_limit_cents: limitCents,
        p_request_id: requestId,
      });
      if (error) {
        // PostgREST surfaces the RAISE EXCEPTION message in error.message.
        throw new Error(error.message);
      }
    },
    async settle({ provider, yearMonth, reservedCents, incurredCents, leadsCount, jobsCount, requestId }) {
      const { error } = await supabaseAdmin.rpc("lead_usage_settle", {
        p_provider: provider,
        p_year_month: yearMonth,
        p_reserved_cents: reservedCents,
        p_incurred_cents: incurredCents,
        p_leads_count: leadsCount,
        p_jobs_count: jobsCount,
        p_request_id: requestId,
      });
      if (error) throw new Error(`lead_usage_settle failed: ${error.message}`);
    },
    async release({ provider, yearMonth, reservedCents, requestId }) {
      const { error } = await supabaseAdmin.rpc("lead_usage_release", {
        p_provider: provider,
        p_year_month: yearMonth,
        p_reserved_cents: reservedCents,
        p_request_id: requestId,
      });
      if (error) throw new Error(`lead_usage_release failed: ${error.message}`);
    },
  };
  return _supabaseStore;
}

/** Test seam: reset memoized supabase store. */
export function __resetSupabaseStore() {
  _supabaseStore = null;
}
