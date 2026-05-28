import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reserveBudget,
  releaseReservation,
  settleReservation,
  currentYearMonth,
  getConfiguredLimitCents,
  type UsageStore,
} from "../cost-guard";
import { CostGuardExceededError } from "../types";

/**
 * In-memory UsageStore that models the production semantics of
 * lead_usage_reserve / settle / release atomically. Tests use it to check
 * the application-level guard contract without standing up Supabase.
 */
function memoryStore(): UsageStore & {
  state: Map<string, { cost: number; reserved: number; leads: number; jobs: number }>;
  reserveCalls: number;
  settleCalls: number;
  releaseCalls: number;
} {
  const state = new Map<
    string,
    { cost: number; reserved: number; leads: number; jobs: number }
  >();
  const key = (p: string, ym: string) => `${p}:${ym}`;
  const ensure = (p: string, ym: string) => {
    const k = key(p, ym);
    if (!state.has(k)) state.set(k, { cost: 0, reserved: 0, leads: 0, jobs: 0 });
    return state.get(k)!;
  };
  return {
    state,
    reserveCalls: 0,
    settleCalls: 0,
    releaseCalls: 0,
    async getMonthlySpentCents(provider, ym) {
      return ensure(provider, ym).cost;
    },
    async reserve({ provider, yearMonth, estimatedCents, limitCents }) {
      this.reserveCalls++;
      const row = ensure(provider, yearMonth);
      // Atomic check + bump, mirroring the RPC.
      if (row.cost + row.reserved + estimatedCents > limitCents) {
        throw new Error("budget_exceeded");
      }
      row.reserved += estimatedCents;
    },
    async settle({ provider, yearMonth, reservedCents, incurredCents, leadsCount, jobsCount }) {
      this.settleCalls++;
      const row = ensure(provider, yearMonth);
      row.reserved = Math.max(0, row.reserved - reservedCents);
      row.cost += incurredCents;
      row.leads += leadsCount;
      row.jobs += jobsCount;
    },
    async release({ provider, yearMonth, reservedCents }) {
      this.releaseCalls++;
      const row = ensure(provider, yearMonth);
      row.reserved = Math.max(0, row.reserved - reservedCents);
    },
  };
}

test("currentYearMonth returns UTC YYYY-MM", () => {
  const ym = currentYearMonth(new Date("2026-05-28T03:00:00Z"));
  assert.equal(ym, "2026-05");
  assert.equal(currentYearMonth(new Date("2026-12-31T23:59:59Z")), "2026-12");
});

test("getConfiguredLimitCents defaults to $50 when env unset", () => {
  delete process.env.MAX_MONTHLY_LEAD_COST_USD;
  assert.equal(getConfiguredLimitCents(), 5000);
});

test("getConfiguredLimitCents reads env in dollars and converts to cents", () => {
  process.env.MAX_MONTHLY_LEAD_COST_USD = "75";
  assert.equal(getConfiguredLimitCents(), 7500);
  process.env.MAX_MONTHLY_LEAD_COST_USD = "10.5";
  assert.equal(getConfiguredLimitCents(), 1050);
  delete process.env.MAX_MONTHLY_LEAD_COST_USD;
});

test("reserveBudget passes when cost + reserved + estimated <= limit", async () => {
  const store = memoryStore();
  // Pre-load $10 already-spent.
  store.state.set("outscraper:2026-05", { cost: 1000, reserved: 0, leads: 0, jobs: 0 });
  await reserveBudget({
    provider: "outscraper",
    estimatedCostCents: 2000,
    store,
    now: new Date("2026-05-28T12:00:00Z"),
    limitCents: 5000,
  });
  // Reservation should be visible.
  assert.equal(store.state.get("outscraper:2026-05")!.reserved, 2000);
});

test("reserveBudget throws CostGuardExceededError when cost + reserved + estimated > limit", async () => {
  const store = memoryStore();
  store.state.set("outscraper:2026-05", { cost: 4500, reserved: 0, leads: 0, jobs: 0 });
  await assert.rejects(
    reserveBudget({
      provider: "outscraper",
      estimatedCostCents: 1000, // 4500 + 1000 = 5500 > 5000
      store,
      now: new Date("2026-05-28T12:00:00Z"),
      limitCents: 5000,
    }),
    (err: unknown) => {
      assert.ok(err instanceof CostGuardExceededError, "should throw CostGuardExceededError");
      const e = err as CostGuardExceededError;
      assert.equal(e.estimatedCents, 1000);
      assert.equal(e.limitCents, 5000);
      assert.equal(e.provider, "outscraper");
      return true;
    }
  );
});

test("reserveBudget closes the check-then-submit race against concurrent submits", async () => {
  // Two concurrent reserves at spent=$48, est=$2 each, limit=$50.
  // Naive check-then-submit would see spent=$48 + $2 ≤ $50 twice and let BOTH
  // through, ending at $52 spent. The atomic reserve must let exactly one
  // through (the second sees reserved=$2 already and trips).
  const store = memoryStore();
  store.state.set("outscraper:2026-05", { cost: 4800, reserved: 0, leads: 0, jobs: 0 });

  const limitCents = 5000;
  const reserve = (n: number) =>
    reserveBudget({ provider: "outscraper", estimatedCostCents: 200, store, limitCents })
      .then(() => `ok-${n}`)
      .catch((err) => `fail-${n}-${(err as Error).constructor.name}`);

  const results = await Promise.all([reserve(1), reserve(2)]);
  const okCount = results.filter((r) => r.startsWith("ok-")).length;
  const failCount = results.filter((r) => r.startsWith("fail-")).length;
  assert.equal(okCount, 1, `exactly one reservation should succeed: ${results.join(",")}`);
  assert.equal(failCount, 1, `the other must trip the guard: ${results.join(",")}`);
  // Reserved budget should be only ONE job's worth, not both.
  assert.equal(store.state.get("outscraper:2026-05")!.reserved, 200);
});

test("reserveBudget at exact limit boundary is allowed (<=, not <)", async () => {
  const store = memoryStore();
  store.state.set("outscraper:2026-05", { cost: 4000, reserved: 0, leads: 0, jobs: 0 });
  await assert.doesNotReject(
    reserveBudget({
      provider: "outscraper",
      estimatedCostCents: 1000, // total 5000 == limit
      store,
      limitCents: 5000,
    })
  );
});

test("settleReservation swaps reservation for incurred cost", async () => {
  const store = memoryStore();
  await reserveBudget({
    provider: "outscraper",
    estimatedCostCents: 1000,
    store,
    limitCents: 5000,
  });
  // Job came back with fewer leads than the cap → actual cost < reservation.
  await settleReservation({
    provider: "outscraper",
    reservedCents: 1000,
    incurredCents: 720,
    leadsCount: 36,
    store,
    requestId: "req-1",
  });
  const row = store.state.get("outscraper:2026-05")!;
  assert.equal(row.reserved, 0, "reservation drained");
  assert.equal(row.cost, 720, "actual cost recorded");
});

test("releaseReservation returns held budget without recording cost (on job failure)", async () => {
  const store = memoryStore();
  await reserveBudget({
    provider: "outscraper",
    estimatedCostCents: 1500,
    store,
    limitCents: 5000,
  });
  await releaseReservation({
    provider: "outscraper",
    reservedCents: 1500,
    store,
    requestId: "req-2",
  });
  const row = store.state.get("outscraper:2026-05")!;
  assert.equal(row.reserved, 0, "reservation released");
  assert.equal(row.cost, 0, "no cost recorded for the failed job");
});

test("reserve+settle compose: budget held across many jobs cannot exceed limit", async () => {
  const store = memoryStore();
  const limitCents = 5000;
  // Try 60 reservations of $1 (100 cents) each — first 50 succeed, rest reject.
  const outcomes: string[] = [];
  for (let i = 0; i < 60; i++) {
    try {
      await reserveBudget({
        provider: "outscraper",
        estimatedCostCents: 100,
        store,
        limitCents,
      });
      outcomes.push("ok");
    } catch (err) {
      outcomes.push((err as Error).constructor.name);
    }
  }
  const okCount = outcomes.filter((o) => o === "ok").length;
  assert.equal(okCount, 50, "exactly limit/cost jobs may reserve");
  const row = store.state.get("outscraper:2026-05")!;
  assert.equal(row.reserved, 5000);
  // Settle them all at the full estimate.
  for (let i = 0; i < 50; i++) {
    await settleReservation({
      provider: "outscraper",
      reservedCents: 100,
      incurredCents: 100,
      leadsCount: 1,
      store,
    });
  }
  const after = store.state.get("outscraper:2026-05")!;
  assert.equal(after.reserved, 0);
  assert.equal(after.cost, 5000);
  // Now even a single $0.01 job must trip the guard.
  await assert.rejects(
    reserveBudget({ provider: "outscraper", estimatedCostCents: 1, store, limitCents }),
    CostGuardExceededError
  );
});
