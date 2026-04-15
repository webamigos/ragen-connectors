import { beforeEach, describe, expect, it, vi } from "vitest";
import { RejestrioClient } from "../../client/rejestrio-client.js";
import type { BudgetGuard } from "../../audit/budget-guard.js";
import type { CompanyProfileRepository } from "../../cache/company-profile-repo.js";
import { RejestrioBudgetExceededError } from "../../client/errors.js";
import { handleGetKrsHistory } from "../get-krs-history.js";

function permissiveBudget(): BudgetGuard {
  return {
    assertAllowed: vi.fn(async () => {}),
  } as unknown as BudgetGuard;
}

type ProfileRow = {
  powiazaniaHistoryczneRaw: unknown;
  powiazaniaHistoryczneFetchedAt: Date | null;
};

function profilesWith(existing: ProfileRow | null): {
  profiles: CompanyProfileRepository;
  upserts: ReturnType<typeof vi.fn>;
} {
  const upserts = vi.fn(async () => undefined);
  const profiles = {
    getFreshByKrs: vi.fn(async () => existing),
    getFreshByNip: vi.fn(async () => null),
    upsertBasic: vi.fn(async () => undefined),
    upsertAdvanced: vi.fn(async () => undefined),
    upsertPowiazania: vi.fn(async () => undefined),
    upsertPowiazaniaHistoryczne: upserts,
  } as unknown as CompanyProfileRepository;
  return { profiles, upserts };
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

// Minimal historical-powiazania fixture: one ex-board member + one
// former parent-company relationship, both with data_koniec set.
const historicalFixture = [
  {
    id: "99001",
    typ: "osoba-bez-pesel",
    tozsamosc: {
      imiona_i_nazwisko: "Anna Kowalska",
    },
    krs_powiazania_kwerendowane: [
      {
        data_start: "2015-06-01",
        data_koniec: "2018-12-31",
        kierunek: "PRZESZLY",
        typ: "KRS_SUPERVISION",
      },
    ],
  },
  {
    id: 12345,
    typ: "organizacja",
    tozsamosc: {
      nazwa: "FORMER PARENT SP. Z O.O.",
    },
    krs_powiazania_kwerendowane: [
      {
        data_start: "2010-01-01",
        data_koniec: "2020-03-15",
        kierunek: "PRZESZLY",
        typ: "KRS_OWNERSHIP",
      },
    ],
  },
];

describe("handleGetKrsHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes aktualnosc=historyczne on a cold call and normalises the result", async () => {
    const fetchStub = queuedFetch([historicalFixture]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const { profiles, upserts } = profilesWith({
      powiazaniaHistoryczneRaw: null,
      powiazaniaHistoryczneFetchedAt: null,
    });

    const result = await handleGetKrsHistory(
      { customer_id: "org-1:user-1:REJESTRIO", krs: "0000634215" },
      { client, budget: permissiveBudget(), profiles },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.source).toBe("upstream");
    expect(result.powiazaniaHistoryczne).toHaveLength(2);
    expect(result.powiazaniaHistoryczne[0]).toMatchObject({
      imionaI_nazwisko: "Anna Kowalska",
      dataKoniec: "2018-12-31",
    });

    const calledUrl = String(fetchStub.mock.calls[0][0]);
    expect(calledUrl).toContain("aktualnosc=historyczne");
    expect(calledUrl).toContain("/krs-powiazania");

    expect(upserts).toHaveBeenCalledOnce();
  });

  it("serves from cache when the historical TTL is fresh", async () => {
    const fetchStub = queuedFetch([]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const { profiles, upserts } = profilesWith({
      powiazaniaHistoryczneRaw: historicalFixture,
      powiazaniaHistoryczneFetchedAt: new Date(),
    });

    const result = await handleGetKrsHistory(
      { customer_id: "org-1:user-1:REJESTRIO", krs: 634215 },
      { client, budget: permissiveBudget(), profiles },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.source).toBe("cache");
    expect(result.powiazaniaHistoryczne).toHaveLength(2);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(upserts).not.toHaveBeenCalled();
  });

  it("short-circuits on budget exceeded", async () => {
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
    const { profiles } = profilesWith(null);

    const result = await handleGetKrsHistory(
      { customer_id: "org-1:user-1:REJESTRIO", krs: 634215 },
      { client, budget: strict, profiles },
    );

    expect(result.success).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("handles empty upstream response cleanly (company with no historical links)", async () => {
    const fetchStub = queuedFetch([[]]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const { profiles } = profilesWith({
      powiazaniaHistoryczneRaw: null,
      powiazaniaHistoryczneFetchedAt: null,
    });

    const result = await handleGetKrsHistory(
      { customer_id: "org-1:user-1:REJESTRIO", krs: 634215 },
      { client, budget: permissiveBudget(), profiles },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.powiazaniaHistoryczne).toEqual([]);
  });
});
