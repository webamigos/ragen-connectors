/**
 * Regression suite for the budget-guard bypass: a `customer_id` whose
 * organization fragment is blank used to parse to `orgId: null`, which
 * `BudgetGuard.assertAllowed` treated as "nothing to enforce" and
 * returned from — so the handler went on to make a billed Rejestr.io
 * call with no daily ceiling and no attribution in the audit log.
 *
 * Every paid tool is driven through a REAL `BudgetGuard` here, not the
 * permissive stub the other suites use — that stub would hide exactly
 * this bug. Each case asserts both halves:
 *
 *   1. the tool refuses with the `{success: false}` envelope rather
 *      than throwing (ADR-03), and
 *   2. `fetch` was never called — no money was spent.
 *
 * The second assertion is the one that matters: a tool could refuse
 * *after* paying and still look correct from the envelope alone.
 */
import { describe, expect, it, vi } from "vitest";
import { RejestrioClient } from "../../client/rejestrio-client.js";
import { BudgetGuard } from "../../audit/budget-guard.js";
import type { RequestAuditRepository } from "../../audit/request-audit-repo.js";
import type { CompanyProfileRepository } from "../../cache/company-profile-repo.js";
import type { FinancialDocumentRepository } from "../../cache/financial-doc-repo.js";
import { handleLookupCompany } from "../lookup-company.js";
import { handleGetKrsChapter } from "../get-krs-chapter.js";
import { handleGetPerson } from "../get-person.js";
import { handleGetPersonConnections } from "../get-person-connections.js";
import { handleGetBeneficialOwners } from "../get-beneficial-owners.js";
import { handleGetKrsInfo } from "../get-krs-info.js";
import { handleGetFinancials } from "../get-financials.js";
import { handleGetKrsHistory } from "../get-krs-history.js";

/** customer_id shapes that yield no attributable organization. */
const UNATTRIBUTED = [
  ":user-1:REJESTRIO", // blank org — the reported bypass
  ":::", // nothing but separators
  "  :user-1:REJESTRIO", // whitespace-only org
  "\t:u:R",
  "",
];

const ATTRIBUTED = "org-1:user-1:REJESTRIO";

type Deps = Parameters<typeof handleGetFinancials>[1];

/** Every tool that can issue a billed upstream call. */
const PAID_TOOLS: Array<{
  name: string;
  run: (customer_id: string, deps: Deps) => Promise<{ success: boolean }>;
}> = [
  {
    name: "lookup_company",
    run: (customer_id, deps) =>
      handleLookupCompany({ customer_id, nip: "1132916831" } as never, deps),
  },
  {
    name: "get_krs_chapter",
    run: (customer_id, deps) =>
      handleGetKrsChapter(
        { customer_id, krs: 634215, chapter: "ogolny" } as never,
        deps,
      ),
  },
  {
    name: "get_person",
    run: (customer_id, deps) =>
      handleGetPerson({ customer_id, personId: 1 } as never, deps),
  },
  {
    name: "get_person_connections",
    run: (customer_id, deps) =>
      handleGetPersonConnections({ customer_id, personId: 1 } as never, deps),
  },
  {
    name: "get_beneficial_owners",
    run: (customer_id, deps) =>
      handleGetBeneficialOwners({ customer_id, krs: 634215 } as never, deps),
  },
  {
    name: "get_krs_info",
    run: (customer_id, deps) =>
      handleGetKrsInfo({ customer_id, krs: 634215 } as never, deps),
  },
  {
    name: "get_financials",
    run: (customer_id, deps) =>
      handleGetFinancials({ customer_id, krs: 634215, years: 1 } as never, deps),
  },
  {
    name: "get_krs_history",
    run: (customer_id, deps) =>
      handleGetKrsHistory({ customer_id, krs: 634215 } as never, deps),
  },
];

/**
 * Real guard, real client, cold caches — so a cache-backed tool still
 * reaches the paid path — plus a fetch stub we can assert against.
 */
function harness(): { deps: Deps; fetchStub: ReturnType<typeof vi.fn> } {
  const fetchStub = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const audit = {
    spentTodayForOrg: vi.fn(async () => 0),
    record: vi.fn(async () => {}),
  } as unknown as RequestAuditRepository;

  return {
    fetchStub,
    deps: {
      client: new RejestrioClient(
        { apiKey: "test-key", baseUrl: "https://api.test/v2" },
        fetchStub,
      ),
      budget: new BudgetGuard({
        audit,
        defaultDailyBudgetPln: 20,
        disabled: false,
      }),
      profiles: {
        getFreshByKrs: vi.fn(async () => null),
        getFreshByNip: vi.fn(async () => null),
        upsertBasic: vi.fn(async () => undefined),
        upsertAdvanced: vi.fn(async () => undefined),
        upsertPowiazania: vi.fn(async () => undefined),
      } as unknown as CompanyProfileRepository,
      finDocs: {
        findByKrs: vi.fn(async () => []),
        isRocznikFresh: vi.fn(async () => false),
        upsert: vi.fn(async () => undefined),
      } as unknown as FinancialDocumentRepository,
    } as unknown as Deps,
  };
}

describe.each(PAID_TOOLS)("$name", ({ run }) => {
  it.each(UNATTRIBUTED)(
    "refuses %j and makes no billed call",
    async (customerId) => {
      const { deps, fetchStub } = harness();

      const result = await run(customerId, deps);

      expect(result.success).toBe(false);
      expect(fetchStub).not.toHaveBeenCalled();
    },
  );

  // Positive control: without this, a tool that refused *everything*
  // would pass the cases above while being completely broken.
  it("still reaches the upstream for an attributed caller", async () => {
    const { deps, fetchStub } = harness();

    await run(ATTRIBUTED, deps);

    expect(fetchStub).toHaveBeenCalled();
  });
});
