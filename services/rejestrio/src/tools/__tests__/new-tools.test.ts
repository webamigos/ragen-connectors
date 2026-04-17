/**
 * Smoke tests for the four tools added alongside the existing
 * lookup / krs / financials set: `get_person`, `get_beneficial_owners`,
 * `get_person_connections`, `get_krs_chapter`.
 *
 * Happy-path per tool + budget short-circuit. No captured fixtures
 * for these endpoints yet — response shapes verified against the
 * scraped docs only. Upgrade to fixture-backed assertions once the
 * probe captures real ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RejestrioClient } from "../../client/rejestrio-client.js";
import type { BudgetGuard } from "../../audit/budget-guard.js";
import { RejestrioBudgetExceededError } from "../../client/errors.js";
import { handleGetPerson } from "../get-person.js";
import { handleGetBeneficialOwners } from "../get-beneficial-owners.js";
import { handleGetPersonConnections } from "../get-person-connections.js";
import { handleGetKrsChapter } from "../get-krs-chapter.js";

function permissiveBudget(): BudgetGuard {
  return {
    assertAllowed: vi.fn(async () => {}),
  } as unknown as BudgetGuard;
}

function strictBudget(): BudgetGuard {
  return {
    assertAllowed: vi.fn(async () => {
      throw new RejestrioBudgetExceededError("org-1", 20, 20);
    }),
  } as unknown as BudgetGuard;
}

function stubFetch(response: unknown) {
  return vi.fn<typeof fetch>(async () => {
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("get_person", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches person data by id", async () => {
    const fetchStub = stubFetch({
      id: 200325,
      tozsamosc: { imiona_i_nazwisko: "Jan Kowalski" },
    });
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const result = await handleGetPerson(
      { customer_id: "org:user:R", personId: 200325 },
      { client, budget: permissiveBudget() },
    );
    expect(result.success).toBe(true);
    expect(String(fetchStub.mock.calls[0][0])).toContain("/osoby/200325");
  });

  it("short-circuits on budget exceeded", async () => {
    const fetchStub = stubFetch({});
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const result = await handleGetPerson(
      { customer_id: "org:user:R", personId: 1 },
      { client, budget: strictBudget() },
    );
    expect(result.success).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("get_beneficial_owners", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches CRBR list for a KRS", async () => {
    const fetchStub = stubFetch([
      { id: 42, kod_kraju_rezydencji: "PL", tozsamosc: { nazwa: "A B" } },
    ]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const result = await handleGetBeneficialOwners(
      { customer_id: "org:user:R", krs: "0000634215" },
      { client, budget: permissiveBudget() },
    );
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.beneficialOwners).toHaveLength(1);
    expect(String(fetchStub.mock.calls[0][0])).toContain("/org/634215/crbr");
  });

  it("short-circuits on budget exceeded", async () => {
    const fetchStub = stubFetch([]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const result = await handleGetBeneficialOwners(
      { customer_id: "org:user:R", krs: 1 },
      { client, budget: strictBudget() },
    );
    expect(result.success).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe("get_person_connections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to aktualnosc=aktualne and hits /osoby/:id/krs-powiazania", async () => {
    const fetchStub = stubFetch([
      {
        id: 123,
        typ: "organizacja",
        nazwy: { pelna: "ACME SP. Z O.O." },
      },
    ]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const result = await handleGetPersonConnections(
      { customer_id: "org:user:R", personId: 200325, aktualnosc: "aktualne" },
      { client, budget: permissiveBudget() },
    );
    expect(result.success).toBe(true);
    const url = String(fetchStub.mock.calls[0][0]);
    expect(url).toContain("/osoby/200325/krs-powiazania");
    expect(url).toContain("aktualnosc=aktualne");
  });

  it("passes aktualnosc=historyczne through when requested", async () => {
    const fetchStub = stubFetch([]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    await handleGetPersonConnections(
      {
        customer_id: "org:user:R",
        personId: 1,
        aktualnosc: "historyczne",
      },
      { client, budget: permissiveBudget() },
    );
    const url = String(fetchStub.mock.calls[0][0]);
    expect(url).toContain("aktualnosc=historyczne");
  });
});

describe("get_krs_chapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hits /org/:krs/krs-rozdzialy/:chapter with the chapter name", async () => {
    const fetchStub = stubFetch({ some_field: { _wartosc: "anything" } });
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const result = await handleGetKrsChapter(
      { customer_id: "org:user:R", krs: "0000634215", chapter: "akcje" },
      { client, budget: permissiveBudget() },
    );
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.chapter).toBe("akcje");
    expect(result.empty).toBe(false);
    expect(String(fetchStub.mock.calls[0][0])).toContain(
      "/org/634215/krs-rozdzialy/akcje",
    );
  });

  it("flags empty=true when the chapter returns []", async () => {
    const fetchStub = stubFetch([]);
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const result = await handleGetKrsChapter(
      { customer_id: "org:user:R", krs: 1, chapter: "zobowiazania" },
      { client, budget: permissiveBudget() },
    );
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.empty).toBe(true);
  });
});
