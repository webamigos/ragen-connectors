/**
 * Shared tier-1 snapshot utilities.
 *
 * Rejestr.io endpoint 02 (basic data) on a Biznes plan carries
 * `ostatnie_sprawozdanie.glowne_pola` inline — the latest year's
 * headline financial figures without any extra API call. Both
 * `get_krs_info` and `get_financials(years=1)` can satisfy
 * "jakie są finanse X?" from this shape alone.
 *
 * Since two different tools can produce the same rows, the extract
 * + persist logic lives here so both sites mirror into
 * `financial_documents` consistently — making the table the single
 * source of truth for "everything we know about a company's
 * financials, regardless of which tool surfaced them".
 */
import { logger } from "@ragen-connectors/core";
import type { FinancialDocumentRepository } from "./financial-doc-repo.js";

export type Tier1Snapshot = {
  rocznik: number | null;
  source: "basic_snapshot";
  przychody?: number | null;
  koszty?: number | null;
  zysk?: number | null;
  aktywa?: number | null;
  pasywa?: number | null;
  podatek?: number | null;
};

type SprawozdanieShape = {
  rocznik?: number;
  glowne_pola?: {
    przychody?: { wartosc?: number };
    koszty?: { wartosc?: number };
    zysk?: { wartosc?: number };
    aktywa?: { wartosc?: number };
    pasywa?: { wartosc?: number };
    podatek_dochodowy?: { wartosc?: number };
  };
};

/**
 * Pull a financial snapshot out of an endpoint 02 response. Returns
 * null when `ostatnie_sprawozdanie.glowne_pola` isn't populated —
 * typical for GPW/consolidated filers or wykreślone entries.
 */
export function extractTier1Snapshot(
  basicResponse: unknown,
): Tier1Snapshot | null {
  if (!basicResponse || typeof basicResponse !== "object") {
    return null;
  }
  const b = basicResponse as { ostatnie_sprawozdanie?: SprawozdanieShape };
  const spr = b.ostatnie_sprawozdanie;
  if (!spr?.glowne_pola) {
    return null;
  }
  return {
    rocznik: spr.rocznik ?? null,
    source: "basic_snapshot",
    przychody: spr.glowne_pola.przychody?.wartosc,
    koszty: spr.glowne_pola.koszty?.wartosc,
    zysk: spr.glowne_pola.zysk?.wartosc,
    aktywa: spr.glowne_pola.aktywa?.wartosc,
    pasywa: spr.glowne_pola.pasywa?.wartosc,
    podatek: spr.glowne_pola.podatek_dochodowy?.wartosc,
  };
}

/**
 * Mirror a tier-1 snapshot into `financial_documents`. Idempotent via
 * the repository's (krs, rocznik) upsert. Failures are logged and
 * swallowed — the mirror is best-effort, must never break the tool
 * that called it.
 */
export async function persistTier1Snapshot(
  finDocs: FinancialDocumentRepository,
  companyKrs: number,
  tier1: Tier1Snapshot,
): Promise<void> {
  if (tier1.rocznik == null) {
    logger.info(
      { companyKrs },
      "persistTier1Snapshot: skipped — tier-1 snapshot has no rocznik",
    );
    return;
  }
  try {
    await finDocs.upsert({
      companyKrs,
      rocznik: tier1.rocznik,
      documentId: null,
      czyMaJson: false,
      source: "basic_snapshot",
      rawPayload: null,
      przychody: tier1.przychody ?? null,
      koszty: tier1.koszty ?? null,
      zysk: tier1.zysk ?? null,
      aktywa: tier1.aktywa ?? null,
      pasywa: tier1.pasywa ?? null,
      podatek: tier1.podatek ?? null,
    });
    logger.info(
      { companyKrs, rocznik: tier1.rocznik },
      "persistTier1Snapshot: mirror row written (source=basic_snapshot)",
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), companyKrs },
      "persistTier1Snapshot: mirror write failed (best-effort, not user-facing)",
    );
  }
}
