/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { OutscraperLeadSource } from "../outscraper-source";
import { CostGuardExceededError } from "../types";

/**
 * The cost guard's default implementation talks to Supabase. The adapter
 * accepts an injected `client` for the SDK side, but `assertWithinBudget`
 * resolves its store from `cost-guard.supabaseUsageStore()` at call time.
 * We monkeypatch the supabaseAdmin module to a stub so the guard can read.
 */

// Replace the supabase client with an in-memory stub before importing adapter modules.
// (Top-level imports already happened — but we only need the methods invoked by
// the code paths under test, so we mutate the supabaseAdmin singleton.)
import { supabaseAdmin } from "../../supabase-admin";
import { __resetSupabaseStore } from "../cost-guard";

const memory: Record<string, number> = {};

function installSupabaseStub() {
  (supabaseAdmin as any).from = (table: string) => {
    if (table === "lead_usage") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const v = memory["outscraper:cur"] ?? 0;
                return { data: { cost_usd_cents: v }, error: null };
              },
            }),
          }),
        }),
      };
    }
    if (table === "lead_jobs") {
      return {
        insert: async () => ({ data: null, error: null }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      };
    }
    return {
      insert: async () => ({ data: null, error: null }),
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    };
  };
  (supabaseAdmin as any).rpc = async () => ({ data: null, error: null });
  __resetSupabaseStore();
}

before(() => {
  installSupabaseStub();
});

beforeEach(() => {
  for (const k of Object.keys(memory)) delete memory[k];
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

test("OutscraperLeadSource trips cost guard BEFORE submitting when spend is over limit", async () => {
  memory["outscraper:cur"] = 4900; // already spent $49.00
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
    source.search({ query: "padaria", region: "SP", limit: 100 }), // est 200 → 4900+200 = 5100 > 5000
    (err: unknown) => err instanceof CostGuardExceededError
  );
  assert.equal(submitted, false, "must not call provider after guard trips");
});

test("OutscraperLeadSource surfaces provider error responses as thrown Error", async () => {
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
});

test("OutscraperLeadSource refuses construction without OUTSCRAPER_WEBHOOK_URL", () => {
  delete process.env.OUTSCRAPER_WEBHOOK_URL;
  assert.throws(
    () => new OutscraperLeadSource({ apiKey: "x", client: { async getAPIRequest() { return {}; } } as any }),
    /OUTSCRAPER_WEBHOOK_URL is required/
  );
});
