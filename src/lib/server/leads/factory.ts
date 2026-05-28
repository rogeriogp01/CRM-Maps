import { OutscraperLeadSource } from "./outscraper-source";
import { PlaywrightLeadSource } from "./playwright-source";
import type { LeadProvider, LeadSource } from "./types";

/**
 * Feature flag dispatcher. `LEAD_SOURCE` env controls which provider is used:
 *   - "outscraper" (default) → OutscraperLeadSource
 *   - "playwright"           → PlaywrightLeadSource (legacy fallback)
 *
 * Defaulting to outscraper matches the ROGA-69 rollout decision. Flipping
 * back to playwright is the rollback path; it takes effect on the next
 * request after env reload (no code redeploy).
 */
export function resolveLeadProvider(): LeadProvider {
  const raw = (process.env.LEAD_SOURCE ?? "outscraper").trim().toLowerCase();
  if (raw === "playwright") return "playwright";
  if (raw === "outscraper") return "outscraper";
  // Anything else: be conservative and fall back to playwright so a typo can't
  // unintentionally enable a paid provider.
  console.warn(
    `[leads/factory] Unknown LEAD_SOURCE="${raw}", falling back to playwright. ` +
      `Set LEAD_SOURCE=outscraper or LEAD_SOURCE=playwright explicitly.`
  );
  return "playwright";
}

/**
 * Build the configured LeadSource. Construction throws when required env is
 * missing (e.g. OUTSCRAPER_API_KEY for outscraper) — that's intentional;
 * a misconfigured prod should fail loud at boot, not silently degrade.
 */
export function buildLeadSource(provider: LeadProvider = resolveLeadProvider()): LeadSource {
  switch (provider) {
    case "outscraper":
      return new OutscraperLeadSource();
    case "playwright":
      return new PlaywrightLeadSource();
    default: {
      const exhaustive: never = provider as never;
      throw new Error(`Unsupported lead provider: ${exhaustive}`);
    }
  }
}
