/**
 * Mapper tests — node:test runner (Node 24 built-in, zero new deps).
 * Run with:  node --import tsx --test src/lib/server/leads/__tests__/mapper.test.ts
 * Or:        npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapOutscraperPlace, mapOutscraperWebhook } from "../mapper";

// __dirname shim for ESM (tsx emits ESM under module:esnext).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = join(__dirname, "fixtures", "outscraper-webhook.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

test("mapOutscraperWebhook maps a full payload to normalized leads", () => {
  const leads = mapOutscraperWebhook(fixture);
  // 4 raw rows: 1 with full data, 1 with partial, 1 with no phone (kept because name exists),
  // 1 with neither name nor phone (dropped). So we expect 3.
  assert.equal(leads.length, 3);

  const padaria = leads[0];
  assert.equal(padaria.name, "Padaria Central");
  assert.equal(padaria.phone, "+55 11 3456-7890");
  assert.equal(padaria.category, "Bakery");
  assert.equal(padaria.rating, 4.6);
  assert.equal(padaria.placeId, "ChIJaaaa1111");
  assert.equal(padaria.source, "outscraper");
  assert.match(padaria.address ?? "", /Paulista/);
});

test("mapOutscraperWebhook composes address when full_address is absent", () => {
  const leads = mapOutscraperWebhook(fixture);
  const cafe = leads.find((l) => l.name === "Café da Esquina");
  assert.ok(cafe);
  // Falls back to `address` field when `full_address` is missing.
  assert.match(cafe!.address ?? "", /Augusta/);

  // Direct unit check on composition path: only city/state present.
  const composed = mapOutscraperPlace({
    name: "Composto",
    phone: "+55 11 0000-0000",
    city: "São Paulo",
    state: "SP",
    country: "BR",
  });
  assert.ok(composed);
  assert.match(composed!.address ?? "", /São Paulo/);
  assert.match(composed!.address ?? "", /SP/);
});

test("mapOutscraperWebhook keeps rows with name but no phone (cost-guarded discard happens later)", () => {
  const leads = mapOutscraperWebhook(fixture);
  const noPhone = leads.find((l) => l.name === "Sem Telefone Ltda");
  assert.ok(noPhone, "row with name but no phone should still be mapped");
  assert.equal(noPhone!.phone, "");
});

test("mapOutscraperWebhook drops rows with neither name nor phone", () => {
  const leads = mapOutscraperWebhook(fixture);
  assert.ok(!leads.some((l) => l.name === "" && l.phone === ""));
});

test("mapOutscraperWebhook tolerates missing data field", () => {
  assert.deepEqual(mapOutscraperWebhook({}), []);
  assert.deepEqual(mapOutscraperWebhook({ data: null }), []);
});

test("mapOutscraperWebhook handles flat data (non-batched) shape", () => {
  const flat = {
    data: [
      { name: "X", phone: "+55 11 9999-0000", category: "Cat", rating: 3.5 },
    ],
  };
  const leads = mapOutscraperWebhook(flat as any);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].name, "X");
  assert.equal(leads[0].source, "outscraper");
});

test("mapOutscraperPlace falls back to phones_enricher when top-level phone is missing", () => {
  const lead = mapOutscraperPlace({
    name: "Test",
    phones_enricher: [{ phone: "+55 21 0000-0000" }],
  });
  assert.ok(lead);
  assert.equal(lead!.phone, "+55 21 0000-0000");
});

test("mapOutscraperPlace returns null for empty rows", () => {
  assert.equal(mapOutscraperPlace({}), null);
  assert.equal(mapOutscraperPlace({ name: "  ", phone: "  " }), null);
});
