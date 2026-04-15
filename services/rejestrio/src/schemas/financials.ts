/**
 * Schemas for Rejestr.io endpoints 10 (list of financial documents)
 * and 11 (single financial document).
 *
 * Endpoint 10: top level is an array of FILING PERIODS, each with
 * `data_start`/`data_koniec`/`dokumenty[]`. Each document carries
 * `czy_ma_json` which is the critical flag for deciding whether it's
 * worth calling endpoint 11.
 *
 * Endpoint 11: returns literal `null` when `czy_ma_json === false`.
 * Non-null responses are structured JSON we capture verbatim; the
 * extraction logic is intentionally conservative in v1 — we have
 * only null fixtures, so parsing non-null payloads is a future-
 * fixture concern.
 */
import { z } from "zod";

const zIntishId = z.union([z.number().int(), z.string()]);

export const finDocListItemSchema = z
  .object({
    id: zIntishId,
    nazwa: z.string(),
    czy_ma_json: z.boolean().optional(),
  })
  .passthrough();

export const finDocListPeriodSchema = z
  .object({
    data_start: z.string().optional(),
    data_koniec: z.string().optional(),
    dokumenty: z.array(finDocListItemSchema).optional(),
  })
  .passthrough();

export const finDocListResponseSchema = z.array(finDocListPeriodSchema);

export type FinDocListItem = z.infer<typeof finDocListItemSchema>;
export type FinDocListPeriod = z.infer<typeof finDocListPeriodSchema>;
export type FinDocListResponse = z.infer<typeof finDocListResponseSchema>;

/**
 * Endpoint 11 response. Accepts both `null` (czy_ma_json=false case)
 * and an object. We don't narrow the object further until we have
 * non-null fixtures to validate against.
 */
export const finDocResponseSchema = z.union([
  z.record(z.unknown()),
  z.null(),
]);

export type FinDocResponse = z.infer<typeof finDocResponseSchema>;

/**
 * Pick the most promising document per period: the one named
 * "Roczne sprawozdanie finansowe" with `czy_ma_json: true` when such
 * a pair exists. Falls back to any `czy_ma_json: true` doc in the
 * period. Returns null when the period has no JSON-bearing document
 * at all — callers cache that as `source='unavailable'`.
 */
export function pickJsonBearingAnnualReport(
  period: FinDocListPeriod,
): FinDocListItem | null {
  const docs = period.dokumenty ?? [];
  const named = docs.find(
    (d) => d.czy_ma_json === true && d.nazwa.includes("Roczne sprawozdanie finansowe"),
  );
  if (named) {
    return named;
  }
  return docs.find((d) => d.czy_ma_json === true) ?? null;
}

/**
 * Extract headline figures from endpoint 11's JSON payload. Shape
 * depends on the filing year's XBRL schema; we only attempt a
 * conservative "looks like glowne_pola" lift. Returns `null` when
 * the shape doesn't match — the caller caches the raw payload for
 * later re-parsing without another 0.50 PLN call.
 */
export function extractHeadlineFigures(
  payload: unknown,
):
  | {
      przychody?: number;
      koszty?: number;
      zysk?: number;
      aktywa?: number;
      pasywa?: number;
      podatek?: number;
    }
  | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  // Support the `glowne_pola: { przychody: { wartosc }, … }` shape
  // seen in endpoint 02's ostatnie_sprawozdanie.
  const p = payload as Record<string, unknown>;
  const gp =
    (p.glowne_pola as Record<string, { wartosc?: number } | undefined>) ??
    undefined;
  if (!gp) {
    return null;
  }
  const num = (x: { wartosc?: number } | undefined): number | undefined =>
    x?.wartosc;
  return {
    przychody: num(gp.przychody),
    koszty: num(gp.koszty),
    zysk: num(gp.zysk),
    aktywa: num(gp.aktywa),
    pasywa: num(gp.pasywa),
    podatek: num(gp.podatek_dochodowy),
  };
}
