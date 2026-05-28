# Outscraper Lead Source — Runbook

Origin: [ROGA-69](/ROGA/issues/ROGA-69) (board approval [b1107cc4](/ROGA/approvals/b1107cc4-9804-43b2-8f74-c378e21d56e6)).
Spike: [ROGA-47](/ROGA/issues/ROGA-47).

## TL;DR

Outscraper is the **primary** lead source. Playwright stays in-repo behind a feature flag as the rollback path until a separate cleanup issue removes it.

```
LEAD_SOURCE=outscraper   # default — async via /api/leads/outscraper/webhook
LEAD_SOURCE=playwright   # fallback — legacy streaming via /api/extractor
```

## Architecture

```
POST /api/leads/search
       │
       ▼
  resolveLeadProvider()  ── reads LEAD_SOURCE env
       │
       ├── outscraper ──▶ OutscraperLeadSource.search()
       │                       │  (1) assertWithinBudget()        ┐
       │                       │  (2) Outscraper async + webhook  │  src/lib/server/leads/
       │                       │  (3) lead_jobs insert            │
       │                       ▼
       │                  HTTP 202 {jobId}    ─────────┐
       │                                               │ (Outscraper job runs N seconds–minutes)
       │                                               ▼
       │             POST /api/leads/outscraper/webhook?token=...
       │                  (1) verifyWebhookToken + verifyHmacSignature
       │                  (2) lead_jobs lookup by request_id (campaign_id + reserved_cost)
       │                  (3) mapOutscraperWebhook  → NormalizedLead[]
       │                  (4) persistNormalizedLeads → campaign_leads (correct campaign)
       │                  (5) settleReservation → lead_usage (cost reconciled)
       │                  (6) lead_jobs.update status=succeeded
       │
       └── playwright ─▶ delegates to existing POST /api/extractor (streaming NDJSON)
```

## Components

| File | Purpose |
| --- | --- |
| `src/lib/server/leads/types.ts` | `LeadSource` interface, `NormalizedLead` shape, `CostGuardExceededError` |
| `src/lib/server/leads/outscraper-source.ts` | Wraps Outscraper SDK 2.2 (async + webhook), enforces guard |
| `src/lib/server/leads/playwright-source.ts` | Fallback marker — delegates to `/api/extractor` |
| `src/lib/server/leads/factory.ts` | Reads `LEAD_SOURCE` env, returns the configured `LeadSource` |
| `src/lib/server/leads/mapper.ts` | Outscraper payload → `NormalizedLead[]` |
| `src/lib/server/leads/cost-guard.ts` | Persistent monthly cost guard (`lead_usage` table) |
| `src/lib/server/leads/webhook-auth.ts` | Token + optional HMAC validation for callbacks |
| `src/lib/server/leads/persist.ts` | Insert normalized leads via existing `bulkInsertLeads` |
| `src/app/api/leads/search/route.ts` | Provider-agnostic search trigger |
| `src/app/api/leads/outscraper/webhook/route.ts` | Async result receiver |
| `database/014_create_lead_usage.sql` | Adds `lead_usage`, `lead_jobs`, extends `campaign_leads.source` |

## Required environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LEAD_SOURCE` | no | `outscraper` | `outscraper` or `playwright` |
| `OUTSCRAPER_API_KEY` | yes (when outscraper) | — | API key from [Outscraper Profile → API/Usage](https://app.outscraper.com/profile) |
| `OUTSCRAPER_WEBHOOK_URL` | yes (when outscraper) | — | Public URL to `/api/leads/outscraper/webhook?token=...` |
| `OUTSCRAPER_WEBHOOK_TOKEN` | yes (when outscraper) | — | Shared secret embedded in webhook URL |
| `OUTSCRAPER_WEBHOOK_HMAC_SECRET` | optional | — | If set, also requires `X-Signature-256` HMAC header (use behind a relay) |
| `OUTSCRAPER_COST_PER_LEAD_CENTS` | no | `2` | Per-lead cost estimate (in cents) used by the guard and post-result reconciliation |
| `MAX_MONTHLY_LEAD_COST_USD` | no | `50` | Hard cap (USD). Jobs that would exceed it return HTTP 429 |

## Local development

1. Apply migration `014_create_lead_usage.sql` to your Supabase project.
2. Set the env vars above in `.env.local`.
3. Start a tunnel so Outscraper can reach your local webhook:
   ```bash
   # any local tunnel works — example with cloudflared
   cloudflared tunnel --url http://localhost:3000
   ```
   Set `OUTSCRAPER_WEBHOOK_URL=https://<your-tunnel>.trycloudflare.com/api/leads/outscraper/webhook?token=$OUTSCRAPER_WEBHOOK_TOKEN`.
4. `npm run dev`.
5. Trigger a search:
   ```bash
   curl -X POST http://localhost:3000/api/leads/search \
     -H 'content-type: application/json' \
     -d '{
       "query":"padaria",
       "region":"São Paulo, SP",
       "limit":50,
       "campaignId":"<uuid>",
       "regionCode":"br"
     }'
   # → 202 { accepted, provider:"outscraper", jobId, estimatedCostCents }
   ```
   - `campaignId` (optional): leads will land on this campaign. Without it they fall back to `DEFAULT_CAMPAIGN_ID` and have to be moved manually.
   - `region` is appended to the Outscraper query for locality context AND interpreted as a 2-letter country code if it happens to be 2 characters. Pass `regionCode` explicitly (ISO-3166-1 alpha-2) when `region` is a free-text locality like `"São Paulo, SP"`.
6. Watch the server log for `[outscraper/webhook] ok request=…` once Outscraper posts back. Leads land in `campaign_leads` with `source='outscraper'`.

## Tests

```bash
npm test
```

Runs all `src/lib/server/leads/__tests__/*.test.ts` via Node's built-in `node:test` (no extra dev deps). The suite covers:

- mapper happy path + edge cases (empty rows, missing fields, batched vs flat shapes)
- cost guard (boundary at exact limit, accumulating across jobs, env parsing)
- Outscraper adapter (submits async + webhook, trips guard before submit, surfaces SDK errors)
- webhook auth (token comparison is timing-safe, optional HMAC envelope)

## Cost guard semantics

The guard enforces `cost + reserved + new_estimate ≤ limit` in a single round-trip via the `lead_usage_reserve` RPC, eliminating the check-then-submit race where two concurrent submits could both pass the limit check at the same `spent` value and end up overspending.

- **Persistent counters**: `lead_usage(provider, year_month, cost_usd_cents, reserved_cents, ...)`. `cost_usd_cents` is settled spend; `reserved_cents` is budget held against in-flight jobs.
- **Atomic reserve** (`OutscraperLeadSource.search()` → `lead_usage_reserve`): asserts `cost + reserved + estimated ≤ limit` inside a single UPDATE; raises `budget_exceeded` (mapped to `CostGuardExceededError` → HTTP 429) when it would overshoot. **The job is never submitted to Outscraper.** A `lead_jobs` audit row is written with status `rejected_by_guard` so the dashboard shows denied attempts.
- **Settle** (webhook → `lead_usage_settle`): subtracts the reservation, adds the actual incurred cost (`leads_received × cost_per_lead_cents`). The per-lead price is read from the `lead_jobs` row (snapshot taken at submit) — not from the env — so a price/key rotation between submit and webhook does not desync the books.
- **Release** (webhook on non-success status, or adapter on submit failure → `lead_usage_release`): drops the reservation without recording any cost. Prevents leaking budget when Outscraper rejects, times out, or the SDK call errors before the job is accepted.
- **Idempotency**: re-deliveries of a `succeeded` webhook do NOT re-settle (`alreadyCounted` short-circuits both the cost record and any second release); campaign_leads upsert is independently idempotent on `(campaign_id, phone_normalized)`.
- Reconcile monthly against the Outscraper invoice. Adjust `OUTSCRAPER_COST_PER_LEAD_CENTS` if the actual blended cost drifts.

## Rotating the API key

1. Generate a new key in the Outscraper dashboard.
2. Update `OUTSCRAPER_API_KEY` in the secrets store (Vercel / your runtime).
3. Redeploy. No DB or code changes needed.
4. Revoke the old key only after the new one shows a successful job in `lead_jobs`.

## Rotating the webhook token

1. Generate a fresh random token (e.g. `openssl rand -hex 32`).
2. Update `OUTSCRAPER_WEBHOOK_TOKEN` **and** `OUTSCRAPER_WEBHOOK_URL` (the URL must include `?token=<new>`) atomically — both are read at request time.
3. Redeploy. There is a brief window where in-flight jobs (submitted with the old token) will hit a 401. Either accept the loss or grace-period the receiver by temporarily accepting both tokens.

## Feature flag — flip in under 5 minutes

```bash
# Roll back to Playwright (does not require a redeploy if env is hot-reloaded):
LEAD_SOURCE=playwright   # next request honors this
# Re-enable Outscraper:
LEAD_SOURCE=outscraper
```

Verify with:
```bash
curl -X POST $BASE/api/leads/search -H 'content-type: application/json' \
  -d '{"query":"test","region":"SP","limit":1}'
# outscraper → 202 { accepted:true, provider:"outscraper" }
# playwright → 200 { delegate:true, provider:"playwright", route:"/api/extractor" }
```

## Runbook: "Outscraper returning 5xx" / job stuck

1. Check provider status: https://outscraper.com (status banner) and https://app.outscraper.com/api-usage.
2. Recent `lead_jobs`:
   ```sql
   select request_id, status, error, submitted_at, completed_at
   from lead_jobs
   where provider='outscraper'
   order by submitted_at desc limit 20;
   ```
3. If a job is stuck in `submitted` > 30 min, fetch its archive:
   ```bash
   curl -H "X-API-KEY: $OUTSCRAPER_API_KEY" \
        "https://api.app.outscraper.com/requests/<REQUEST_ID>"
   ```
4. **If provider is down**, flip `LEAD_SOURCE=playwright` to restore lead flow. Notify the board with the incident timestamp, expected restore, and the Outscraper status URL.
5. After Outscraper recovers, flip back to `LEAD_SOURCE=outscraper`. Cost guard automatically reflects whatever was already spent that month — no manual reset needed.
6. **If the webhook receiver is returning 401**, verify the token in env matches the token in the webhook URL Outscraper has on file (check by re-submitting a small test job and inspecting the webhook log).

## Audit / ToS attribution

Every persisted lead has `source='outscraper'` (or `'playwright'`) on the `campaign_leads` row. The `lead_jobs` table keeps the full request lineage (`query`, `region`, `requested_limit`, provider `request_id`, cost). If Google ToS is ever questioned, contractual exposure stays with Outscraper and we have a clean audit trail showing we did not scrape directly during the Outscraper period.

## Non-scope (separate issues)

- Removing Playwright code from the repo — after 1 month of stable Outscraper in prod.
- Places API adapter — only if Outscraper is discontinued; the `LeadSource` interface is the seam.
- Changing the downstream pipeline consumer (`bulkInsertLeads`) — intentionally untouched.
