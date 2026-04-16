/**
 * Tests for `handleGetKrsInfo`. Drives real captured fixtures
 * (endpoints 02 / 03-ogolny / 06) through the tool with:
 *   - fetch stubbed (no network)
 *   - CompanyProfileRepository mocked (no DB)
 *   - BudgetGuard stubbed permissive or strict per test
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RejestrioClient } from "../../client/rejestrio-client.js";
import type { BudgetGuard } from "../../audit/budget-guard.js";
import type { CompanyProfileRepository } from "../../cache/company-profile-repo.js";
import type { FinancialDocumentRepository } from "../../cache/financial-doc-repo.js";
import { RejestrioBudgetExceededError } from "../../client/errors.js";
import { handleGetKrsInfo } from "../get-krs-info.js";

/**
 * No-op finDocs fixture. get_krs_info mirrors tier-1 snapshots into
 * financial_documents for the "single source of truth" view, but the
 * tests here don't assert on that behaviour (the dedicated
 * `get-financials.test.ts` already covers mirror-write semantics).
 */
function noopFinDocs(): FinancialDocumentRepository {
  return {
    findByKrs: vi.fn(async () => []),
    isRocznikFresh: vi.fn(async () => false),
    upsert: vi.fn(async () => undefined),
  } as unknown as FinancialDocumentRepository;
}

function spyFinDocs(): {
  repo: FinancialDocumentRepository;
  upsert: ReturnType<typeof vi.fn>;
} {
  const upsert = vi.fn(async () => undefined);
  return {
    repo: {
      findByKrs: vi.fn(async () => []),
      isRocznikFresh: vi.fn(async () => false),
      upsert,
    } as unknown as FinancialDocumentRepository,
    upsert,
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../../probe/fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

function permissiveBudget(): BudgetGuard {
  return {
    assertAllowed: vi.fn(async () => {}),
  } as unknown as BudgetGuard;
}

/**
 * Matches the subset of `CompanyProfile` fields we read. `null`-y
 * timestamps trigger the upstream path; non-null ones within TTL hit
 * cache.
 */
type ProfileRow = {
  basicRaw: unknown;
  advancedRaw: unknown;
  powiazaniaRaw: unknown;
  basicFetchedAt: Date | null;
  advancedFetchedAt: Date | null;
  powiazaniaFetchedAt: Date | null;
};

function repoWith(existing: ProfileRow | null): {
  profiles: CompanyProfileRepository;
  upserts: {
    basic: ReturnType<typeof vi.fn>;
    advanced: ReturnType<typeof vi.fn>;
    powiazania: ReturnType<typeof vi.fn>;
  };
} {
  const basic = vi.fn(async () => undefined);
  const advanced = vi.fn(async () => undefined);
  const powiazania = vi.fn(async () => undefined);
  const profiles = {
    getFreshByKrs: vi.fn(async () => existing),
    getFreshByNip: vi.fn(async () => null),
    upsertBasic: basic,
    upsertAdvanced: advanced,
    upsertPowiazania: powiazania,
  } as unknown as CompanyProfileRepository;
  return { profiles, upserts: { basic, advanced, powiazania } };
}

/**
 * Sequential fetch stub — each call returns the next queued response.
 * Catches "too many calls" loudly rather than repeating the last one.
 */
function queuedFetch(responses: Array<unknown | Response>) {
  let i = 0;
  return vi.fn<typeof fetch>(async () => {
    if (i >= responses.length) {
      throw new Error(`fetch called more than ${responses.length} times`);
    }
    const r = responses[i++];
    if (r instanceof Response) {
      return r;
    }
    return new Response(JSON.stringify(r), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("handleGetKrsInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("composes all three endpoints on cold cache and caches each section", async () => {
    const basic = loadFixture("02-krs-0000634215.json");
    const advanced = loadFixture("03-krs-0000634215-ogolny.json");
    const powiazania = loadFixture("06-krs-0000634215.json");
    const fetchStub = queuedFetch([basic, advanced, powiazania]);

    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const { profiles, upserts } = repoWith(null);

    const result = await handleGetKrsInfo(
      { customer_id: "org-1:user-1:REJESTRIO", krs: "0000634215" },
      { client, budget: permissiveBudget(), profiles, finDocs: noopFinDocs() },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.krs).toBe(634215);
    expect(result.krsPadded).toBe("0000634215");
    expect(result.nazwaPelna).toBeTruthy();
    expect(result.sources).toEqual({
      basic: "upstream",
      advanced: "upstream",
      powiazania: "upstream",
    });
    expect(fetchStub).toHaveBeenCalledTimes(3);
    expect(upserts.basic).toHaveBeenCalledOnce();
    expect(upserts.advanced).toHaveBeenCalledOnce();
    expect(upserts.powiazania).toHaveBeenCalledOnce();
  });

  it("lifts ostatnie_sprawozdanie.glowne_pola out of basic-data for SMEs", async () => {
    const basic = loadFixture("02-krs-0000634215.json");
    const advanced = loadFixture("03-krs-0000634215-ogolny.json");
    const powiazania = loadFixture("06-krs-0000634215.json");
    const fetchStub = queuedFetch([basic, advanced, powiazania]);

    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const { profiles } = repoWith(null);

    const result = await handleGetKrsInfo(
      { customer_id: "org-1:user-1:REJESTRIO", krs: 634215 },
      { client, budget: permissiveBudget(), profiles, finDocs: noopFinDocs() },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.ostatnieSprawozdanie).not.toBeNull();
    expect(result.ostatnieSprawozdanie?.przychody).toBeGreaterThan(0);
    expect(result.ostatnieSprawozdanie?.rocznik).toBeGreaterThan(2000);
  });

  it("serves all sections from cache when fresh — zero fetch calls", async () => {
    const basic = loadFixture("02-krs-0000634215.json");
    const advanced = loadFixture("03-krs-0000634215-ogolny.json");
    const powiazania = loadFixture("06-krs-0000634215.json");
    const fetchStub = queuedFetch([]);

    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const now = new Date();
    const { profiles, upserts } = repoWith({
      basicRaw: basic,
      advancedRaw: advanced,
      powiazaniaRaw: powiazania,
      basicFetchedAt: now,
      advancedFetchedAt: now,
      powiazaniaFetchedAt: now,
    });

    const result = await handleGetKrsInfo(
      { customer_id: "org-1:user-1:REJESTRIO", krs: "0000634215" },
      { client, budget: permissiveBudget(), profiles, finDocs: noopFinDocs() },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.sources).toEqual({
      basic: "cache",
      advanced: "cache",
      powiazania: "cache",
    });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(upserts.basic).not.toHaveBeenCalled();
    expect(upserts.advanced).not.toHaveBeenCalled();
    expect(upserts.powiazania).not.toHaveBeenCalled();
  });

  it("re-fetches only the stale section (partial freshness)", async () => {
    const basicCached = loadFixture("02-krs-0000634215.json");
    const advancedCached = loadFixture("03-krs-0000634215-ogolny.json");
    const powiazaniaFresh = loadFixture("06-krs-0000634215.json");
    // Only powiązania is stale — basic + advanced served from cache.
    const fetchStub = queuedFetch([powiazaniaFresh]);

    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const freshDate = new Date();
    const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const { profiles, upserts } = repoWith({
      basicRaw: basicCached,
      advancedRaw: advancedCached,
      powiazaniaRaw: null,
      basicFetchedAt: freshDate,
      advancedFetchedAt: freshDate,
      powiazaniaFetchedAt: staleDate,
    });

    const result = await handleGetKrsInfo(
      { customer_id: "org-1:user-1:REJESTRIO", krs: 634215 },
      { client, budget: permissiveBudget(), profiles, finDocs: noopFinDocs() },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.sources).toEqual({
      basic: "cache",
      advanced: "cache",
      powiazania: "upstream",
    });
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(upserts.basic).not.toHaveBeenCalled();
    expect(upserts.advanced).not.toHaveBeenCalled();
    expect(upserts.powiazania).toHaveBeenCalledOnce();
  });

  it("flags advancedEmpty=true when endpoint 03 returns [] (insolvent fixture)", async () => {
    const basic = loadFixture("02-krs-0000458061.json");
    const advanced = loadFixture("03-krs-0000458061-ogolny.json"); // []
    const powiazania = loadFixture("06-krs-0000458061.json");
    const fetchStub = queuedFetch([basic, advanced, powiazania]);

    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const { profiles } = repoWith(null);

    const result = await handleGetKrsInfo(
      { customer_id: "org-1:user-1:REJESTRIO", krs: "0000458061" },
      { client, budget: permissiveBudget(), profiles, finDocs: noopFinDocs() },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.advancedEmpty).toBe(true);
  });

  it("short-circuits on budget exceeded without hitting Rejestr.io", async () => {
    const fetchStub = queuedFetch([]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const strict = {
      assertAllowed: vi.fn(async () => {
        throw new RejestrioBudgetExceededError("org-1", 20, 20);
      }),
    } as unknown as BudgetGuard;
    const { profiles } = repoWith(null);

    const result = await handleGetKrsInfo(
      { customer_id: "org-1:user-1:REJESTRIO", krs: 634215 },
      { client, budget: strict, profiles, finDocs: noopFinDocs() },
    );

    expect(result.success).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("accepts both padded and integer KRS input", async () => {
    const basic = loadFixture("02-krs-0000634215.json");
    const advanced = loadFixture("03-krs-0000634215-ogolny.json");
    const powiazania = loadFixture("06-krs-0000634215.json");

    for (const krs of ["0000634215", "634215", 634215]) {
      const fetchStub = queuedFetch([basic, advanced, powiazania]);
      const client = new RejestrioClient(
        { apiKey: "k", baseUrl: "https://api.test/v2" },
        fetchStub,
      );
      const { profiles } = repoWith(null);

      const result = await handleGetKrsInfo(
        { customer_id: "org-1:user-1:REJESTRIO", krs },
        { client, budget: permissiveBudget(), profiles, finDocs: noopFinDocs() },
      );

      expect(result.success).toBe(true);
      if (!result.success) {
        continue;
      }
      expect(result.krs).toBe(634215);
      expect(result.krsPadded).toBe("0000634215");
    }
  });

  it("mirrors the basic-data snapshot into financial_documents when glowne_pola is populated", async () => {
    const basic = loadFixture("02-krs-0000634215.json");
    const advanced = loadFixture("03-krs-0000634215-ogolny.json");
    const powiazania = loadFixture("06-krs-0000634215.json");
    const fetchStub = queuedFetch([basic, advanced, powiazania]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const { profiles } = repoWith(null);
    const { repo: finDocs, upsert } = spyFinDocs();

    await handleGetKrsInfo(
      { customer_id: "org-1:user-1:REJESTRIO", krs: 634215 },
      { client, budget: permissiveBudget(), profiles, finDocs },
    );

    expect(upsert).toHaveBeenCalledOnce();
    const row = upsert.mock.calls[0][0] as {
      source: string;
      companyKrs: number;
    };
    expect(row.source).toBe("basic_snapshot");
    expect(row.companyKrs).toBe(634215);
  });

  it("does NOT mirror when basic has no glowne_pola (GPW/consolidated filer)", async () => {
    const basic = loadFixture("02-krs-0000010681.json");
    const advanced = loadFixture("03-krs-0000010681-ogolny.json");
    const powiazania = loadFixture("06-krs-0000010681.json");
    const fetchStub = queuedFetch([basic, advanced, powiazania]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const { profiles } = repoWith(null);
    const { repo: finDocs, upsert } = spyFinDocs();

    await handleGetKrsInfo(
      { customer_id: "org-1:user-1:REJESTRIO", krs: 10681 },
      { client, budget: permissiveBudget(), profiles, finDocs },
    );

    expect(upsert).not.toHaveBeenCalled();
  });
});
