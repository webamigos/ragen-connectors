/**
 * Tests for the `lookup_company` tool handler. Drives real captured
 * Rejestr.io responses (from src/probe/fixtures/) through the
 * client + tool pipeline, with fetch stubbed — no network, no cost.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RejestrioClient } from "../../client/rejestrio-client.js";
import type { BudgetGuard } from "../../audit/budget-guard.js";
import { RejestrioBudgetExceededError } from "../../client/errors.js";
import { handleLookupCompany } from "../lookup-company.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../../probe/fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

function stubFetch(response: Response) {
  // Typed as `typeof fetch` so mock.calls preserves the (url, init) tuple.
  return vi.fn<typeof fetch>(async () => response);
}

function makeResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function permissiveBudget(): BudgetGuard {
  return {
    assertAllowed: vi.fn(async () => {}),
  } as unknown as BudgetGuard;
}

function strictBudget(err: Error): BudgetGuard {
  return {
    assertAllowed: vi.fn(async () => {
      throw err;
    }),
  } as unknown as BudgetGuard;
}

describe("handleLookupCompany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured hits for a NIP search (small sp. z o.o. fixture)", async () => {
    const fixture = loadFixture("01-nip-1132916831.json");
    const fetchStub = stubFetch(makeResponse(fixture));
    const client = new RejestrioClient(
      { apiKey: "test-key", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const budget = permissiveBudget();

    const result = await handleLookupCompany(
      { customer_id: "org1:user1:REJESTRIO", nip: "1132916831" },
      { client, budget },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.results.length).toBeGreaterThan(0);
    const first = result.results[0];
    expect(first.krs).toBe(Number(first.krs)); // numeric
    expect(first.krsPadded).toMatch(/^\d{10}$/);
    expect(first.nazwaPelna).toBeTruthy();
  });

  it("passes exactly one search param to Rejestr.io", async () => {
    const fixture = loadFixture("01-nip-5260250995.json");
    const fetchStub = stubFetch(makeResponse(fixture));
    const client = new RejestrioClient(
      { apiKey: "test-key", baseUrl: "https://api.test/v2" },
      fetchStub,
    );

    await handleLookupCompany(
      { customer_id: "org1:user1:REJESTRIO", nip: "5260250995" },
      { client, budget: permissiveBudget() },
    );

    expect(fetchStub).toHaveBeenCalledOnce();
    const calledUrl = String(fetchStub.mock.calls[0][0]);
    expect(calledUrl).toContain("nip=5260250995");
    expect(calledUrl).not.toContain("regon=");
    expect(calledUrl).not.toContain("nazwa=");
  });

  it("sends the bare-token Authorization header (NOT Bearer)", async () => {
    const fixture = loadFixture("01-nip-5260250995.json");
    const fetchStub = stubFetch(makeResponse(fixture));
    const client = new RejestrioClient(
      { apiKey: "secret-token", baseUrl: "https://api.test/v2" },
      fetchStub,
    );

    await handleLookupCompany(
      { customer_id: "org1:user1:REJESTRIO", nip: "5260250995" },
      { client, budget: permissiveBudget() },
    );

    const init = fetchStub.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("secret-token");
    // Guard against a well-meaning "fix" that adds Bearer.
    expect(headers.Authorization).not.toMatch(/^Bearer /);
  });

  it("asks the budget guard before making any upstream call", async () => {
    const fixture = loadFixture("01-nip-5260250995.json");
    const fetchStub = stubFetch(makeResponse(fixture));
    const client = new RejestrioClient(
      { apiKey: "test-key", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const budget = permissiveBudget();

    await handleLookupCompany(
      { customer_id: "org-123:user-456:REJESTRIO", nip: "5260250995" },
      { client, budget },
    );

    expect(budget.assertAllowed).toHaveBeenCalledWith("org-123", 0.05);
  });

  it("forwards ctx (orgId, userId, nip) to the client for audit attribution", async () => {
    const fixture = loadFixture("01-nip-5260250995.json");
    const fetchStub = stubFetch(makeResponse(fixture));
    const hook = vi.fn();
    const client = new RejestrioClient(
      {
        apiKey: "test-key",
        baseUrl: "https://api.test/v2",
        onCallComplete: hook,
      },
      fetchStub,
    );

    await handleLookupCompany(
      { customer_id: "org-123:user-456:REJESTRIO", nip: "5260250995" },
      { client, budget: permissiveBudget() },
    );

    expect(hook).toHaveBeenCalledOnce();
    const outcome = hook.mock.calls[0][0];
    expect(outcome.ctx).toMatchObject({
      orgId: "org-123",
      userId: "user-456",
      nip: "5260250995",
    });
  });

  it("short-circuits on budget-exceeded without calling Rejestr.io", async () => {
    const fetchStub = vi.fn();
    const client = new RejestrioClient(
      { apiKey: "test-key", baseUrl: "https://api.test/v2" },
      fetchStub,
    );
    const budget = strictBudget(
      new RejestrioBudgetExceededError("org-123", 20, 19.99),
    );

    const result = await handleLookupCompany(
      { customer_id: "org-123:user-456:REJESTRIO", nip: "5260250995" },
      { client, budget },
    );

    expect(result.success).toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("surfaces a structured error when Rejestr.io returns 401", async () => {
    const fetchStub = stubFetch(
      new Response('{"kod":401,"info":"unauthorized"}', {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new RejestrioClient(
      {
        apiKey: "bad-key",
        baseUrl: "https://api.test/v2",
        maxRetries: 0, // don't waste test time on backoff
      },
      fetchStub,
    );

    const result = await handleLookupCompany(
      { customer_id: "org1:user1:REJESTRIO", nip: "5260250995" },
      { client, budget: permissiveBudget() },
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error).toMatch(/401|API key/);
  });

  it("accepts a zod-validated REGON search", async () => {
    const fixture = loadFixture("01-nip-5260250995.json");
    const fetchStub = stubFetch(makeResponse(fixture));
    const client = new RejestrioClient(
      { apiKey: "test-key", baseUrl: "https://api.test/v2" },
      fetchStub,
    );

    const result = await handleLookupCompany(
      { customer_id: "org1:user1:REJESTRIO", regon: "123456789" },
      { client, budget: permissiveBudget() },
    );

    expect(result.success).toBe(true);
    const calledUrl = String(fetchStub.mock.calls[0][0]);
    expect(calledUrl).toContain("regon=123456789");
  });
});
