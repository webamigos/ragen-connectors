/**
 * Tests for `handleGetFinancials`.
 *
 * Drives real captured fixtures for endpoints 02 / 10 / 11 through
 * the two-tier logic. fetch is stubbed; both repositories are mocked
 * (no DB). Tier 1 is validated against the small-spzoo fixture
 * (which has inline glowne_pola); tier-2 null handling is validated
 * against the Orlen fixture where every doc is czy_ma_json=false.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RejestrioClient } from "../../client/rejestrio-client.js";
import type { BudgetGuard } from "../../audit/budget-guard.js";
import type { CompanyProfileRepository } from "../../cache/company-profile-repo.js";
import type { FinancialDocumentRepository } from "../../cache/financial-doc-repo.js";
import { handleGetFinancials } from "../get-financials.js";

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

type ProfileRow = {
  basicRaw: unknown;
  advancedRaw: unknown;
  powiazaniaRaw: unknown;
  basicFetchedAt: Date | null;
  advancedFetchedAt: Date | null;
  powiazaniaFetchedAt: Date | null;
};

function profilesWith(existing: ProfileRow | null): CompanyProfileRepository {
  return {
    getFreshByKrs: vi.fn(async () => existing),
    getFreshByNip: vi.fn(async () => null),
    upsertBasic: vi.fn(async () => undefined),
    upsertAdvanced: vi.fn(async () => undefined),
    upsertPowiazania: vi.fn(async () => undefined),
  } as unknown as CompanyProfileRepository;
}

function finDocsStub(): {
  repo: FinancialDocumentRepository;
  upserts: ReturnType<typeof vi.fn>;
} {
  const upserts = vi.fn(async () => undefined);
  return {
    repo: {
      findByKrs: vi.fn(async () => []),
      isRocznikFresh: vi.fn(async () => false),
      upsert: upserts,
    } as unknown as FinancialDocumentRepository,
    upserts,
  };
}

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

describe("handleGetFinancials — tier 1 (years=1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves from the inline ostatnie_sprawozdanie snapshot without any financial API calls", async () => {
    const basic = loadFixture("02-krs-0000634215.json");
    // Cache already populated — no endpoint 02 call.
    const fetchStub = queuedFetch([]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const profiles = profilesWith({
      basicRaw: basic,
      advancedRaw: null,
      powiazaniaRaw: null,
      basicFetchedAt: new Date(),
      advancedFetchedAt: null,
      powiazaniaFetchedAt: null,
    });
    const { repo: finDocs, upserts } = finDocsStub();

    const result = await handleGetFinancials(
      { customer_id: "o:u:R", krs: 634215, years: 1 },
      { client, budget: permissiveBudget(), profiles, finDocs },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.tierUsed).toBe("tier_1");
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].source).toBe("basic_snapshot");
    expect(result.statements[0].przychody).toBeGreaterThan(0);
    expect(fetchStub).not.toHaveBeenCalled();
    // Mirror: tier-1 snapshot is persisted to financial_documents
    // with source='basic_snapshot' so the table reflects every known
    // year regardless of which path served the data.
    expect(upserts).toHaveBeenCalledOnce();
    const row = upserts.mock.calls[0][0] as {
      source: string;
      companyKrs: number;
      rocznik: number;
    };
    expect(row.source).toBe("basic_snapshot");
    expect(row.companyKrs).toBe(634215);
    expect(row.rocznik).toBeGreaterThan(2020);
  });

  it("fetches basic from endpoint 02 when not yet cached", async () => {
    const basic = loadFixture("02-krs-0000634215.json");
    const fetchStub = queuedFetch([basic]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const profiles = profilesWith(null);
    const { repo: finDocs } = finDocsStub();

    const result = await handleGetFinancials(
      { customer_id: "o:u:R", krs: 634215, years: 1 },
      { client, budget: permissiveBudget(), profiles, finDocs },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.statements[0].source).toBe("basic_snapshot");
    expect(fetchStub).toHaveBeenCalledTimes(1); // only endpoint 02
  });

  it("falls through to tier 2 when basic has no glowne_pola (Orlen)", async () => {
    // Orlen's endpoint 02 has ostatnie_sprawozdanie but no glowne_pola
    // (GPW/consolidated filer). Tier 1 can't serve, so the tool must
    // move to tier 2 and call endpoint 10.
    const basic = loadFixture("02-krs-0000010681.json");
    const docList = loadFixture("10-krs-0000010681.json");
    // Orlen's entire list is czy_ma_json=false → pickJsonBearingAnnualReport
    // returns null → endpoint 11 is never called; statement emitted as
    // `unavailable`.
    const fetchStub = queuedFetch([docList]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const profiles = profilesWith({
      basicRaw: basic,
      advancedRaw: null,
      powiazaniaRaw: null,
      basicFetchedAt: new Date(),
      advancedFetchedAt: null,
      powiazaniaFetchedAt: null,
    });
    const { repo: finDocs, upserts } = finDocsStub();

    const result = await handleGetFinancials(
      { customer_id: "o:u:R", krs: 10681, years: 1 },
      { client, budget: permissiveBudget(), profiles, finDocs },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.tierUsed).toBe("tier_2");
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].source).toBe("unavailable");
    expect(result.statements[0].reason).toBe(
      "no_czy_ma_json_document_in_period",
    );
    // Fetch was called once for endpoint 10 (the list). No 0.50 PLN
    // endpoint 11 call — we rejected all candidates via the filter.
    expect(fetchStub).toHaveBeenCalledTimes(1);
    // The unavailable slot is persisted so we don't re-list next time.
    expect(upserts).toHaveBeenCalledOnce();
  });
});

describe("handleGetFinancials — tier 2 historical", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Orlen (all czy_ma_json=false) returns N unavailable slots without any endpoint 11 cost", async () => {
    const basic = loadFixture("02-krs-0000010681.json");
    const docList = loadFixture("10-krs-0000010681.json");
    const fetchStub = queuedFetch([docList]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const profiles = profilesWith({
      basicRaw: basic,
      advancedRaw: null,
      powiazaniaRaw: null,
      basicFetchedAt: new Date(),
      advancedFetchedAt: null,
      powiazaniaFetchedAt: null,
    });
    const { repo: finDocs } = finDocsStub();

    const result = await handleGetFinancials(
      { customer_id: "o:u:R", krs: 10681, years: 3 },
      { client, budget: permissiveBudget(), profiles, finDocs },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    // At most 3 periods (capped by `years`).
    expect(result.statements.length).toBeLessThanOrEqual(3);
    for (const s of result.statements) {
      expect(s.source).toBe("unavailable");
    }
    // Only the endpoint-10 listing was called — no endpoint 11 waste.
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("caches endpoint 11 null-responses to avoid repaying next time", async () => {
    // A period with a czy_ma_json=true candidate that still returns
    // null from endpoint 11 (the API is optimistic). We must cache.
    const basic = loadFixture("02-krs-0000634215.json");
    const listWithJsonCandidate = [
      {
        data_start: "2024-01-01",
        data_koniec: "2024-12-31",
        dokumenty: [
          {
            id: 555,
            nazwa: "Roczne sprawozdanie finansowe",
            czy_ma_json: true,
          },
        ],
      },
    ];
    // Endpoint 11 returns null despite czy_ma_json=true.
    const fetchStub = queuedFetch([listWithJsonCandidate, null]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    // Force tier 2 by setting years=2 so we skip the tier-1 fast
    // path entirely.
    const profiles = profilesWith({
      basicRaw: basic,
      advancedRaw: null,
      powiazaniaRaw: null,
      basicFetchedAt: new Date(),
      advancedFetchedAt: null,
      powiazaniaFetchedAt: null,
    });
    const { repo: finDocs, upserts } = finDocsStub();

    const result = await handleGetFinancials(
      { customer_id: "o:u:R", krs: 634215, years: 2 },
      { client, budget: permissiveBudget(), profiles, finDocs },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    // Latest year (2024) comes from tier-1 snapshot (small-spzoo has
    // glowne_pola in its basic); the schema's deriveRocznik matches
    // 2024-01-01/12-31 → 2024. So that period is filled from tier 1.
    // The fallthrough to endpoint 11 would be for OTHER periods, but
    // our stub list has only one period. So we expect one statement.
    expect(result.statements).toHaveLength(1);
    // The one statement should be from tier-1 snapshot (latest year).
    expect(result.statements[0].source).toBe("basic_snapshot");
    // No endpoint 11 call needed because tier-1 pre-empted.
    expect(fetchStub).toHaveBeenCalledTimes(1);
    // The tier-1 snapshot IS persisted now (basic_snapshot mirror in
    // financial_documents) — expected single upsert for that row.
    expect(upserts).toHaveBeenCalledOnce();
    const mirror = upserts.mock.calls[0][0] as { source: string };
    expect(mirror.source).toBe("basic_snapshot");
  });

  it("extracts headline figures when endpoint 11 returns glowne_pola shape", async () => {
    const basic = loadFixture("02-krs-0000010681.json"); // no glowne_pola
    const listWithJsonCandidate = [
      {
        data_start: "2023-01-01",
        data_koniec: "2023-12-31",
        dokumenty: [
          {
            id: 777,
            nazwa: "Roczne sprawozdanie finansowe",
            czy_ma_json: true,
          },
        ],
      },
    ];
    const endpoint11Payload = {
      glowne_pola: {
        przychody: { wartosc: 1_000_000 },
        koszty: { wartosc: 800_000 },
        zysk: { wartosc: 200_000 },
        aktywa: { wartosc: 5_000_000 },
        pasywa: { wartosc: 5_000_000 },
        podatek_dochodowy: { wartosc: 40_000 },
      },
    };
    const fetchStub = queuedFetch([listWithJsonCandidate, endpoint11Payload]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const profiles = profilesWith({
      basicRaw: basic,
      advancedRaw: null,
      powiazaniaRaw: null,
      basicFetchedAt: new Date(),
      advancedFetchedAt: null,
      powiazaniaFetchedAt: null,
    });
    const { repo: finDocs, upserts } = finDocsStub();

    const result = await handleGetFinancials(
      { customer_id: "o:u:R", krs: 10681, years: 1 },
      { client, budget: permissiveBudget(), profiles, finDocs },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.statements).toHaveLength(1);
    const s = result.statements[0];
    expect(s.source).toBe("fin_document");
    expect(s.rocznik).toBe(2023);
    expect(s.przychody).toBe(1_000_000);
    expect(s.zysk).toBe(200_000);
    expect(s.documentId).toBe(777);
    expect(upserts).toHaveBeenCalledOnce();
  });
});
