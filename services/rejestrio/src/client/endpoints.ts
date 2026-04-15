/**
 * Rejestr.io endpoint catalog — single source of truth for paths,
 * per-call cost, and plan-tier gating. The HTTP client and cost audit
 * both read from here.
 *
 * Keep in sync with `services/rejestrio/docs/*.md` when the docs or
 * pricing change.
 */

export type EndpointId =
  | "01"
  | "02"
  | "03"
  | "04"
  | "05"
  | "06"
  | "07"
  | "10"
  | "11";

export type PlanTier = "base" | "premium" | "biznes";

export type EndpointSpec = {
  /** Short human-readable label for logs + audit. */
  label: string;
  /** Polish per-call cost in PLN (source: Rejestr.io 2026-04-15 pricing). */
  costPln: number;
  /** Lowest plan tier that can call this endpoint. */
  minPlanTier: PlanTier;
};

export const ENDPOINTS: Record<EndpointId, EndpointSpec> = {
  "01": {
    label: "wyszukiwanie-organizacji",
    costPln: 0.05,
    minPlanTier: "base",
  },
  "02": {
    label: "podstawowe-dane-organizacji",
    costPln: 0.05,
    minPlanTier: "base",
  },
  "03": {
    label: "zaawansowane-dane-organizacji",
    costPln: 0.05,
    minPlanTier: "base", // 'ogolny' chapter. Some chapters are Premium.
  },
  "04": {
    label: "dane-osoby",
    costPln: 0.05,
    minPlanTier: "base",
  },
  "05": {
    label: "beneficjenci-rzeczywisci-crbr",
    costPln: 0.05,
    minPlanTier: "premium",
  },
  "06": {
    label: "krs-powiazania",
    costPln: 0.05,
    minPlanTier: "base", // historical requires Premium — handled per-call
  },
  "07": {
    label: "powiazania-osoby",
    costPln: 0.05,
    minPlanTier: "base", // historical variant requires Premium
  },
  "10": {
    label: "lista-dokumentow-finansowych",
    costPln: 0.05,
    minPlanTier: "premium",
  },
  "11": {
    label: "dokument-finansowy-organizacji",
    costPln: 0.5,
    minPlanTier: "premium",
  },
};

const TIER_RANK: Record<PlanTier, number> = {
  base: 0,
  premium: 1,
  biznes: 2,
};

export function tierSatisfies(have: PlanTier, need: PlanTier): boolean {
  return TIER_RANK[have] >= TIER_RANK[need];
}

/**
 * Rejestr.io's integer KRS wants no leading zeros. Canonical KRS is
 * 10-digit zero-padded (e.g. `0000010681`). This helper strips the
 * zeros but only after validating the shape so a garbage input errors
 * loudly instead of silently normalising.
 */
export function toApiKrs(krs: string | number): string {
  const s = String(krs);
  if (!/^\d{1,10}$/.test(s)) {
    throw new Error(`Invalid KRS "${s}" — must be 1–10 digits`);
  }
  const stripped = s.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : "0";
}

/**
 * Canonical 10-digit zero-padded KRS. Use this for display, cache
 * keys, DB writes — anywhere a human might read the value.
 */
export function toCanonicalKrs(krs: string | number): string {
  const s = String(krs).replace(/^0+/, "");
  if (!/^\d{1,10}$/.test(s)) {
    throw new Error(`Invalid KRS "${krs}" — must be 1–10 digits`);
  }
  return s.padStart(10, "0");
}
