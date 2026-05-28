/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OutscraperLeadSource } from "../outscraper-source";
import { CostGuardExceededError } from "../types";

/**
 * The cost guard's default implementation talks to Supabase via RPCs
 * (lead_usage_reserve / settle / release). The adapter accepts an injected
 * `client` for the SDK side, but the guard resolves its store from
 * `cost-guard.supabaseUsageStore()` at call time. We monkeypatch the
 * supabaseAdmin module to a stub that models the reserve atomically — that
 * way the adapter exercises the same atomic-check semantics it would in
 * production.
 */
import { supabaseAdmin } from "../../supabase-admin";
import { __resetSupabaseStore } from "../cost-guard";

interface UsageRow {
  cost: number;
  reserved: number;
}
const memory = new Map<string, UsageRow>();
let leadJobInserts: any[] = [];

function row(provider: string, ym: string) {
  const k = `${provider}:${ym}`;
  if (!memory.has(k)) memory.set(k, { cost: 0, reserved: 0 });
  return memory.get(k)!;
}

function installSupabaseStub() {
  (supabaseAdmin as any).from = (table: string) => {
    if (table === "lead_usage") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                // Sum across all months for simplicity; tests only use one.
                let total = 0;
                memory.forEach((r) => (total += r.cost));
                return { data: { cost_usd_cents: total }, error: null };
              },
            }),
          }),
        }),
      };
    }
    if (table === "lead_jobs") {
      return {
        insert: async (rows: any) => {
          leadJobInserts.push(rows);
          return { data: null, error: null };
        },
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      };
    }
    return {
      insert: async () => ({ data: null, error: null }),
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    };
  };
  (supabaseAdmin as any).rpc = async (name: string, params: any) => {
    if (name === "lead_usage_reserve") {
      const r = row(params.p_provider, params.p_year_month);
      if (r.cost + r.reserved + params.p_estimated_cents > params.p_limit_cents) {
        return { data: null, error: { message: "budget_exceeded" } };
      }
      r.reserved += params.p_estimated_cents;
      return { data: r, error: null };
    }
    if (name === "lead_usage_settle") {
      const r = row(params.p_provider, params.p_year_month);
      r.reserved = Math.max(0, r.reserved - params.p_reserved_cents);
      r.cost += params.p_incurred_cents;
      return { data: r, error: null };
    }
    if (name === "lead_usage_release") {
      const r = row(params.p_provider, params.p_year_month);
      r.reserved = Math.max(0, r.reserved - params.p_reserved_cents);
      return { data: r, error: null };
    }
    return { data: null, error: null };
  };
  __resetSupabaseStore();
}

before(() => {
  installSupabaseStub();
});

beforeEach(() => {
  memory.clear();
  leadJobInserts = [];
  process.env.OUTSCRAPER_WEBHOOK_URL = "https://example.com/api/leads/outscraper/webhook?token=t";
  process.env.OUTSCRAPER_COST_PER_LEAD_CENTS = "2";
  process.env.MAX_MONTHLY_LEAD_COST_USD = "50";
});

afterEach(() => {
  delete process.env.OUTSCRAPER_WEBHOOK_URL;
  delete process.env.OUTSCRAPER_COST_PER_LEAD_CENTS;
  delete process.env.MAX_MONTHLY_LEAD_COST_USD;
});

test("OutscraperLeadSource submits async job with webhook + returns handle", async () => {
  let captured: any = null;
  const client = {
    async getAPIRequest(path: string, params: any) {
      captured = { path, params };
      return { id: "req-xyz", status: "Pending" };
    },
  };
  const source = new OutscraperLeadSource({
    apiKey: "test",
    webhookUrl: "https://example.com/api/leads/outscraper/webhook?token=t",
    client: client as any,
    costPerLeadCents: 2,
  });

  const result = await source.search({ query: "padaria", region: "SP", limit: 100 });

  assert.equal(result.kind, "async");
  if (result.kind !== "async") throw new Error("unreachable");
  assert.equal(result.provider, "outscraper");
  assert.equal(result.requestId, "req-xyz");
  assert.equal(result.estimatedCostCents, 200);

  assert.equal(captured.path, "/maps/search-v3");
  assert.equal(captured.params.async, true);
  assert.equal(captured.params.webhook, "https://example.com/api/leads/outscraper/webhook?token=t");
  assert.equal(captured.params.organizationsPerQueryLimit, 100);
  assert.deepEqual(captured.params.query, ["padaria SP"]);
});

test("OutscraperLeadSource snapshots reserved + per-lead price on lead_jobs row", async () => {
  const client = {
    async getAPIRequest() {
      return { id: "req-snap", status: "Pending" };
    },
  };
  const source = new OutscraperLeadSource({
    apiKey: "test",
    webhookUrl: "https://example.com/wh?token=t",
    client: client as any,
    costPerLeadCents: 2,
  });
  await source.search({
    query: "padaria",
    region: "SP",
    limit: 100,
    campaignId: "11111111-1111-1111-1111-111111111111",
  });
  const inserted = leadJobInserts.find(
    (r) => r.status === "submitted" && r.request_id === "req-snap"
  );
  assert.ok(inserted, "submitted lead_jobs row was written");
  assert.equal(inserted.reserved_cost_usd_cents, 200);
  assert.equal(inserted.cost_per_lead_cents, 2);
  assert.equal(inserted.campaign_id, "11111111-1111-1111-1111-111111111111");
});

test("OutscraperLeadSource trips cost guard BEFORE submitting when spend is over limit", async () => {
  memory.set("outscraper:" + currentYearMonth(), { cost: 4900, reserved: 0 });
  let submitted = false;
  const client = {
    async getAPIRequest() {
      submitted = true;
      return { id: "should-not-happen" };
    },
  };
  const source = new OutscraperLeadSource({
    apiKey: "test",
    webhookUrl: "https://example.com/wh?token=t",
    client: client as any,
    costPerLeadCents: 2,
  });

  await assert.rejects(
    source.search({ query: "padaria", region: "SP", limit: 100 }), // est 200 → 4900+200 > 5000
    (err: unknown) => err instanceof CostGuardExceededError
  );
  assert.equal(submitted, false, "must not call provider after guard trips");

  // Audit row was inserted with rejected_by_guard status (should-fix #9).
  const rejected = leadJobInserts.find((r) => r.status === "rejected_by_guard");
  assert.ok(rejected, "guard-rejected attempts must leave an audit row");
});

test("OutscraperLeadSource releases reservation when provider submit errors", async () => {
  const ym = currentYearMonth();
  const client = {
    async getAPIRequest() {
      return { error: "rate limited" };
    },
  };
  const source = new OutscraperLeadSource({
    apiKey: "test",
    webhookUrl: "https://example.com/wh?token=t",
    client: client as any,
    costPerLeadCents: 2,
  });
  await assert.rejects(
    source.search({ query: "x", region: "SP", limit: 10 }),
    /rate limited/
  );
  const r = memory.get(`outscraper:${ym}`);
  assert.equal(r?.reserved ?? 0, 0, "reservation must be released on submit error");
});

test("OutscraperLeadSource refuses construction without OUTSCRAPER_WEBHOOK_URL", () => {
  delete process.env.OUTSCRAPER_WEBHOOK_URL;
  assert.throws(
    () =>
      new OutscraperLeadSource({
        apiKey: "x",
        client: {
          async getAPIRequest() {
            return {};
          },
        } as any,
      }),
    /OUTSCRAPER_WEBHOOK_URL is required/
  );
});

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
