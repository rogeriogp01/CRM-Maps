import type { NormalizedLead } from "./types";

/**
 * Outscraper Google Maps Search payload shape (subset we care about). Fields
 * are best-effort because the provider periodically renames/adds fields. The
 * mapper is tolerant: missing fields become null, not throws.
 *
 * Reference fixtures live in `__tests__/fixtures/`.
 */
export interface OutscraperGoogleMapsPlace {
  name?: string | null;
  full_address?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  phones_enricher?: { phone?: string }[] | null;
  category?: string | null;
  type?: string | null;
  subtypes?: string | null;
  rating?: number | null;
  reviews?: number | null;
  place_id?: string | null;
  google_id?: string | null;
  query?: string | null;
}

/**
 * Outscraper async webhook payload (mode=async). Shape per
 * https://app.outscraper.com/api-docs#tag/Webhooks. We only need a tiny slice.
 */
export interface OutscraperWebhookBody {
  id?: string;
  user_id?: string;
  status?: string;
  api_task?: boolean;
  results_location?: string;
  /** Some integrations inline `data` directly; others require a fetch from results_location. */
  data?: OutscraperGoogleMapsPlace[][] | OutscraperGoogleMapsPlace[] | null;
}

/**
 * Map a single Outscraper place row to the normalized lead shape.
 *
 * Returns null when the row has neither a name nor a phone — those rows are
 * not actionable for outbound and we'd just discard them later in the pipeline.
 */
export function mapOutscraperPlace(
  place: OutscraperGoogleMapsPlace
): NormalizedLead | null {
  const name = (place.name ?? "").trim();
  const phone =
    (place.phone ?? "").trim() ||
    place.phones_enricher?.find((p) => p.phone)?.phone?.trim() ||
    "";

  if (!name && !phone) return null;

  const address = pickFirstString([
    place.full_address,
    place.address,
    composeAddress(place),
  ]);

  const category = pickFirstString([place.category, place.type, place.subtypes]);

  return {
    name,
    phone,
    address,
    category,
    rating: typeof place.rating === "number" ? place.rating : null,
    placeId: pickFirstString([place.place_id, place.google_id]),
    source: "outscraper",
  };
}

/**
 * Map an Outscraper async webhook body to a flat list of normalized leads.
 *
 * Outscraper batches results: top-level `data` is an array-of-arrays
 * (one inner array per submitted query). We flatten and drop null entries.
 */
export function mapOutscraperWebhook(body: OutscraperWebhookBody): NormalizedLead[] {
  const data = body.data;
  if (!data) return [];

  const flat: OutscraperGoogleMapsPlace[] = Array.isArray(data[0])
    ? (data as OutscraperGoogleMapsPlace[][]).flat()
    : (data as OutscraperGoogleMapsPlace[]);

  const out: NormalizedLead[] = [];
  for (const place of flat) {
    const lead = mapOutscraperPlace(place);
    if (lead) out.push(lead);
  }
  return out;
}

function pickFirstString(candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

function composeAddress(place: OutscraperGoogleMapsPlace): string | null {
  const parts = [place.address, place.city, place.state, place.postal_code, place.country]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}
