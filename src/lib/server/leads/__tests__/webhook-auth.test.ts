import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyHmacSignature, verifyWebhookToken } from "../webhook-auth";

test("verifyWebhookToken rejects when env not configured", () => {
  delete process.env.OUTSCRAPER_WEBHOOK_TOKEN;
  assert.equal(verifyWebhookToken("anything"), false);
});

test("verifyWebhookToken accepts the configured token", () => {
  process.env.OUTSCRAPER_WEBHOOK_TOKEN = "shared-secret-123";
  assert.equal(verifyWebhookToken("shared-secret-123"), true);
  assert.equal(verifyWebhookToken("shared-secret-12"), false);
  assert.equal(verifyWebhookToken("shared-secret-1234"), false);
  assert.equal(verifyWebhookToken(""), false);
  assert.equal(verifyWebhookToken(null), false);
  delete process.env.OUTSCRAPER_WEBHOOK_TOKEN;
});

test("verifyHmacSignature is a no-op when HMAC secret is unset", () => {
  delete process.env.OUTSCRAPER_WEBHOOK_HMAC_SECRET;
  assert.equal(verifyHmacSignature("any body", null), true);
});

test("verifyHmacSignature validates a sha256 HMAC envelope when secret is set", () => {
  process.env.OUTSCRAPER_WEBHOOK_HMAC_SECRET = "hmac-secret";
  const body = '{"hello":"world"}';
  const good = "sha256=" + createHmac("sha256", "hmac-secret").update(body).digest("hex");
  assert.equal(verifyHmacSignature(body, good), true);
  assert.equal(verifyHmacSignature(body, "sha256=deadbeef"), false);
  assert.equal(verifyHmacSignature(body, null), false);
  // Wrong body, right header for previous body, must fail.
  assert.equal(verifyHmacSignature('{"hello":"mars"}', good), false);
  delete process.env.OUTSCRAPER_WEBHOOK_HMAC_SECRET;
});
