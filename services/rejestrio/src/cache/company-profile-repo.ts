/**
 * TTL-aware repository for `CompanyProfile` and `FinancialDocument`.
 *
 * Intentionally thin — the tool handler does the orchestration
 * (read cache → miss → call client → write cache). The repository
 * just hides the Prisma shape and the canonical/padded KRS
 * bookkeeping.
 */
import type { PrismaClient } from "../generated/prisma/client.js";
import { toCanonicalKrs } from "../client/endpoints.js";
import { CACHE_TTL_MS, isFresh } from "./ttl.js";

/** Shape of the Rejestr.io endpoint 02 payload we care to cache. */
export type BasicProfileCachePayload = {
  id: number;
  nip?: string | number;
  regon?: string | number;
  nazwaPelna: string;
  nazwaSkrocona?: string;
  formaPrawna?: string;
  pkdGlowny?: string;
  /** Full raw endpoint 02 response — always stored verbatim. */
  raw: unknown;
};

export class CompanyProfileRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Fresh-or-null lookup by integer KRS. */
  async getFreshByKrs(krs: number, ttlMs = CACHE_TTL_MS.krsInfo) {
    const row = await this.db.companyProfile.findUnique({
      where: { krs },
    });
    if (!row || !isFresh(row.basicFetchedAt, ttlMs)) {
      return null;
    }
    return row;
  }

  /**
   * Fresh-or-null lookup by NIP. One NIP can match several KRS entries
   * (historical legal forms — see schema comment on `nip`); we return
   * the most recently-updated one to favour the current legal form.
   * Callers that need the full list of KRS forms for a NIP should
   * lookup_company via the upstream API rather than this cache.
   */
  async getFreshByNip(nip: string, ttlMs = CACHE_TTL_MS.krsInfo) {
    const row = await this.db.companyProfile.findFirst({
      where: { nip },
      orderBy: { updatedAt: "desc" },
    });
    if (!row || !isFresh(row.basicFetchedAt, ttlMs)) {
      return null;
    }
    return row;
  }

  /**
   * Upsert a basic (endpoint 02) profile. Writes the full raw payload
   * to `basicRaw` for later re-parsing without another upstream call.
   */
  async upsertBasic(
    krs: number,
    payload: BasicProfileCachePayload,
    fetchedAt: Date = new Date(),
  ) {
    const krsPadded = toCanonicalKrs(krs);
    const nip = payload.nip != null ? String(payload.nip) : null;
    const regon = payload.regon != null ? String(payload.regon) : null;

    return this.db.companyProfile.upsert({
      where: { krs },
      update: {
        krsPadded,
        nip,
        regon,
        nazwaPelna: payload.nazwaPelna,
        nazwaSkrocona: payload.nazwaSkrocona ?? null,
        formaPrawna: payload.formaPrawna ?? null,
        pkdGlowny: payload.pkdGlowny ?? null,
        basicRaw: payload.raw as never,
        basicFetchedAt: fetchedAt,
      },
      create: {
        krs,
        krsPadded,
        nip,
        regon,
        nazwaPelna: payload.nazwaPelna,
        nazwaSkrocona: payload.nazwaSkrocona ?? null,
        formaPrawna: payload.formaPrawna ?? null,
        pkdGlowny: payload.pkdGlowny ?? null,
        basicRaw: payload.raw as never,
        basicFetchedAt: fetchedAt,
      },
    });
  }

  async upsertAdvanced(
    krs: number,
    raw: unknown,
    fetchedAt: Date = new Date(),
  ) {
    return this.db.companyProfile.update({
      where: { krs },
      data: {
        advancedRaw: raw as never,
        advancedFetchedAt: fetchedAt,
      },
    });
  }

  async upsertPowiazania(
    krs: number,
    raw: unknown,
    fetchedAt: Date = new Date(),
  ) {
    return this.db.companyProfile.update({
      where: { krs },
      data: {
        powiazaniaRaw: raw as never,
        powiazaniaFetchedAt: fetchedAt,
      },
    });
  }
}
