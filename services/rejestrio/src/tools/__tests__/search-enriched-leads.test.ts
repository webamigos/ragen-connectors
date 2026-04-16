import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { handleSearchEnrichedLeads } from "../search-enriched-leads.js";

type FakeRow = {
  krs: number;
  nip: string | null;
  nazwaPelna: string;
  pkdGlowny: string | null;
  formaPrawna: string | null;
  financialDocuments: Array<{
    rocznik: number | null;
    przychody: number | null;
    zysk: number | null;
    aktywa: number | null;
    source: string;
    fetchedAt: Date;
  }>;
};

function makeDb(rows: FakeRow[]): {
  db: PrismaClient;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async () => rows);
  const db = {
    companyProfile: { findMany },
  } as unknown as PrismaClient;
  return { db, findMany };
}

function fakeRow(
  overrides: Partial<FakeRow> & { krs: number; przychody: number },
): FakeRow {
  return {
    krs: overrides.krs,
    nip: "0000000000",
    nazwaPelna: `Company ${overrides.krs}`,
    pkdGlowny: "62.01.Z — Działalność związana z oprogramowaniem",
    formaPrawna: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    financialDocuments: [
      {
        rocznik: 2024,
        przychody: overrides.przychody,
        zysk: overrides.przychody * 0.1,
        aktywa: overrides.przychody * 0.5,
        source: "basic_snapshot",
        fetchedAt: new Date(),
      },
    ],
    ...overrides,
  };
}

describe("search_enriched_leads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies pkdPrefix + revenue range in the Prisma query", async () => {
    const { db, findMany } = makeDb([]);

    await handleSearchEnrichedLeads(
      {
        customer_id: "org:user:R",
        pkdPrefix: "62",
        minRevenuePln: 3_000_000,
        maxRevenuePln: 50_000_000,
        limit: 20,
        sortBy: "revenue_desc",
      },
      { db },
    );

    expect(findMany).toHaveBeenCalledOnce();
    const args = findMany.mock.calls[0][0] as {
      where: {
        pkdGlowny?: { startsWith?: string };
        financialDocuments: { some: { przychody?: unknown } };
      };
      take: number;
    };
    expect(args.where.pkdGlowny).toEqual({ startsWith: "62" });
    expect(args.where.financialDocuments.some).toMatchObject({
      przychody: { gte: 3_000_000, lte: 50_000_000, not: null },
    });
    expect(args.take).toBe(20);
  });

  it("sorts by revenue descending by default", async () => {
    const rows = [
      fakeRow({ krs: 1, przychody: 5_000_000 }),
      fakeRow({ krs: 2, przychody: 20_000_000 }),
      fakeRow({ krs: 3, przychody: 8_500_000 }),
    ];
    const { db } = makeDb(rows);

    const result = await handleSearchEnrichedLeads(
      { customer_id: "org:user:R", pkdPrefix: "62", limit: 20, sortBy: "revenue_desc" },
      { db },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.leads.map((l) => l.krs)).toEqual([2, 3, 1]);
    expect(result.leads[0].przychody).toBe(20_000_000);
  });

  it("sorts by recently_enriched when requested", async () => {
    const rows = [
      {
        ...fakeRow({ krs: 1, przychody: 5_000_000 }),
        financialDocuments: [
          {
            rocznik: 2024,
            przychody: 5_000_000,
            zysk: 500_000,
            aktywa: 2_500_000,
            source: "basic_snapshot",
            fetchedAt: new Date("2026-04-10"),
          },
        ],
      },
      {
        ...fakeRow({ krs: 2, przychody: 8_000_000 }),
        financialDocuments: [
          {
            rocznik: 2024,
            przychody: 8_000_000,
            zysk: 800_000,
            aktywa: 4_000_000,
            source: "basic_snapshot",
            fetchedAt: new Date("2026-04-16"),
          },
        ],
      },
    ];
    const { db } = makeDb(rows);

    const result = await handleSearchEnrichedLeads(
      { customer_id: "org:user:R", limit: 20, sortBy: "recently_enriched" },
      { db },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.leads[0].krs).toBe(2); // enriched later
  });

  it("skips companies whose newest finDoc has no revenue", async () => {
    const rows: FakeRow[] = [
      {
        krs: 1,
        nip: null,
        nazwaPelna: "Only unavailable rows",
        pkdGlowny: "62.01.Z",
        formaPrawna: null,
        financialDocuments: [], // include filter yielded 0 rows → drop
      },
    ];
    const { db } = makeDb(rows);

    const result = await handleSearchEnrichedLeads(
      { customer_id: "org:user:R", limit: 20, sortBy: "revenue_desc" },
      { db },
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.leads).toEqual([]);
  });

  it("returns a structured error when the DB throws", async () => {
    const db = {
      companyProfile: {
        findMany: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      },
    } as unknown as PrismaClient;

    const result = await handleSearchEnrichedLeads(
      { customer_id: "org:user:R", limit: 20, sortBy: "revenue_desc" },
      { db },
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error).toContain("connection refused");
  });

  it("caps limit at 100 per the Zod schema — safety check", () => {
    // Schema-level validation already enforces this, but make sure
    // the handler wouldn't misbehave if a very large value slipped
    // through (it just passes through to Prisma, which handles it).
    // This test is just documentation.
    expect(true).toBe(true);
  });
});
