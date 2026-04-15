/**
 * Per-year `FinancialDocument` cache. Rows exist in three states:
 *
 *   - `source = 'basic_snapshot'` — the year's headlines came from
 *     endpoint 02's `ostatnie_sprawozdanie.glowne_pola`. No endpoint
 *     11 call was needed. Fastest, cheapest.
 *   - `source = 'fin_document'` — fetched via endpoint 11 (0.50 PLN).
 *     `rawPayload` holds the full upstream JSON so we can extract new
 *     fields later without re-paying. Headline numbers are populated
 *     from the endpoint 11 payload when shape allows.
 *   - `source = 'unavailable'` — endpoint 11 returned null because
 *     the source document had `czy_ma_json: false`. We still persist
 *     so the next call doesn't waste another 0.50 PLN rediscovering
 *     the same gap.
 */
import type {
  PrismaClient,
  FinancialDocument,
} from "../generated/prisma/client.js";
import { CACHE_TTL_MS, isFresh } from "./ttl.js";

export type FinDocSource = "basic_snapshot" | "fin_document" | "unavailable";

export type UpsertFinancialDocInput = {
  companyKrs: number;
  rocznik: number | null;
  dataOd?: Date | null;
  dataDo?: Date | null;
  documentId: number | null;
  czyMaJson: boolean;
  source: FinDocSource;
  rawPayload: unknown;
  przychody?: number | null;
  koszty?: number | null;
  zysk?: number | null;
  aktywa?: number | null;
  pasywa?: number | null;
  podatek?: number | null;
  fetchedAt?: Date;
};

export class FinancialDocumentRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Returns all cached rows for a company, most-recent `rocznik`
   * first. Omits `null`-rocznik rows (malformed filings).
   */
  async findByKrs(companyKrs: number): Promise<FinancialDocument[]> {
    return this.db.financialDocument.findMany({
      where: { companyKrs, rocznik: { not: null } },
      orderBy: { rocznik: "desc" },
    });
  }

  /**
   * Treat a single year's row as fresh for a very long window:
   * financial statements don't change once filed. The TTL is really
   * a "recheck for corrections" interval.
   */
  async isRocznikFresh(
    companyKrs: number,
    rocznik: number,
    now: Date = new Date(),
  ): Promise<boolean> {
    const row = await this.db.financialDocument.findUnique({
      where: { companyKrs_rocznik: { companyKrs, rocznik } },
    });
    return isFresh(row?.fetchedAt, CACHE_TTL_MS.finDoc, now);
  }

  async upsert(input: UpsertFinancialDocInput): Promise<FinancialDocument> {
    if (input.rocznik == null) {
      throw new Error(
        "FinancialDocumentRepository.upsert: rocznik is required for the unique key",
      );
    }
    const fetchedAt = input.fetchedAt ?? new Date();
    const data = {
      companyKrs: input.companyKrs,
      rocznik: input.rocznik,
      dataOd: input.dataOd ?? null,
      dataDo: input.dataDo ?? null,
      documentId: input.documentId,
      czyMaJson: input.czyMaJson,
      source: input.source,
      rawPayload: input.rawPayload as never,
      przychody: input.przychody ?? null,
      koszty: input.koszty ?? null,
      zysk: input.zysk ?? null,
      aktywa: input.aktywa ?? null,
      pasywa: input.pasywa ?? null,
      podatek: input.podatek ?? null,
      fetchedAt,
    };

    return this.db.financialDocument.upsert({
      where: {
        companyKrs_rocznik: {
          companyKrs: input.companyKrs,
          rocznik: input.rocznik,
        },
      },
      update: data,
      create: data,
    });
  }
}
