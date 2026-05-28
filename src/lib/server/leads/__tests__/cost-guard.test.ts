import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertWithinBudget,
  currentYearMonth,
  getConfiguredLimitCents,
  recordUsage,
  type UsageStore,
} from "../cost-guard";
import { CostGuardExceededError } from "../types";

function memoryStore(initial: Record<string, number> = {}): UsageStore & {
  reads: number;
  writes: { provider: string; yearMonth: string; costCents: number }[];
  state: Record<string, number>;
} {
  const state = { ...initial };
  const writes: { provider: string; yearMonth: string; costCents: number }[] = [];
  return {
    state,
    reads: 0,
    writes,
    async getMonthlySpentCents(provider, ym) {
      this.reads++;
      return state[`${provider}:${ym}`] ?? 0;
    },
    async increment({ provider, yearMonth, costCents }) {
      writes.push({ provider, yearMonth, costCents });
      const key = `${provider}:${yearMonth}`;
      state[key] = (state[key] ?? 0) + costCents;
    },
  };
}

test("currentYearMonth returns UTC YYYY-MM", () => {
  const ym = currentYearMonth(new Date("2026-05-28T03:00:00Z"));
  assert.equal(ym, "2026-05");
  // Edge: late UTC time on last day of month must not bleed into next month at local TZ.
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

test("assertWithinBudget passes when spent + estimated <= limit", async () => {
  const store = memoryStore({ "outscraper:2026-05": 1000 });
  const result = await assertWithinBudget({
    provider: "outscraper",
    estimatedCostCents: 2000,
    store,
    now: new Date("2026-05-28T12:00:00Z"),
    limitCents: 5000,
  });
  assert.equal(result.spentCents, 1000);
  assert.equal(result.limitCents, 5000);
});

test("assertWithinBudget throws CostGuardExceededError when spent + estimated > limit", async () => {
  const store = memoryStore({ "outscraper:2026-05": 4500 });
  await assert.rejects(
    assertWithinBudget({
      provider: "outscraper",
      estimatedCostCents: 1000, // 4500 + 1000 = 5500 > 5000
      store,
      now: new Date("2026-05-28T12:00:00Z"),
      limitCents: 5000,
    }),
    (err: unknown) => {
      assert.ok(err instanceof CostGuardExceededError, "should throw CostGuardExceededError");
      const e = err as CostGuardExceededError;
      assert.equal(e.spentCents, 4500);
      assert.equal(e.estimatedCents, 1000);
      assert.equal(e.limitCents, 5000);
      assert.equal(e.provider, "outscraper");
      return true;
    }
  );
});

test("assertWithinBudget tripping at exactly limit boundary keeps the guard strict (>)", async () => {
  // spent + estimated == limit must pass (we only trip when it EXCEEDS).
  const store = memoryStore({ "outscraper:2026-05": 4000 });
  await assert.doesNotReject(
    assertWithinBudget({
      provider: "outscraper",
      estimatedCostCents: 1000, // total 5000 == limit
      store,
      now: new Date("2026-05-28T12:00:00Z"),
      limitCents: 5000,
    })
  );
});

test("recordUsage increments the store with the requested amounts", async () => {
  const store = memoryStore();
  await recordUsage({
    provider: "outscraper",
    costCents: 200,
    leadsCount: 100,
    requestId: "req-1",
    store,
    now: new Date("2026-05-28T12:00:00Z"),
  });
  assert.equal(store.state["outscraper:2026-05"], 200);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].costCents, 200);
});

test("recordUsage + assertWithinBudget compose to enforce the cap across multiple jobs", async () => {
  const store = memoryStore();
  // Spend 30 jobs of $0.20 each = $6.00 = 600 cents, well under $50.
  for (let i = 0; i < 30; i++) {
    await recordUsage({ provider: "outscraper", costCents: 20, leadsCount: 10, store });
  }
  // Total now: 600 cents. Limit: 5000. Add a $44 job → spent 4400+600=5000? Wait:
  // We've spent 600, so an estimated 4500 job → 5100 > 5000 should trip.
  await assert.rejects(
    assertWithinBudget({
      provider: "outscraper",
      estimatedCostCents: 4500,
      store,
      limitCents: 5000,
    }),
    CostGuardExceededError
  );
  // But an estimated 4300 → 4900 ≤ 5000 should pass.
  await assert.doesNotReject(
    assertWithinBudget({
      provider: "outscraper",
      estimatedCostCents: 4300,
      store,
      limitCents: 5000,
    })
  );
});
