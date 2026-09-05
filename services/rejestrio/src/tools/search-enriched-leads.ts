/**
 * MCP tool: `search_enriched_leads`
 *
 * Answers the question "among companies I've already enriched in this
 * pool, which ones match criteria X?". Queries the local rejestrio
 * DB (`company_profiles` JOIN `financial_documents`) — no upstream
 * Rejestr.io call, zero PLN cost.
 *
 * Scope is intentionally narrow:
 * - Only considers companies we've already cached (via `get_krs_info`
 *   / `get_financials` calls). To widen the pool, enrich more
 *   companies first.
 * - Filters: PKD prefix (e.g. "62" for IT), revenue range per
 *   `financial_documents.przychody`, optional rocznik constraint.
 * - Sorted results, capped `limit`.
 *
 * NOT a substitute for `lookup_company` — that hits KRS-wide
 * search live. This tool finds matches *in your own pool*.
 */
import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { logger } from "@ragen-connectors/core";
import type { PrismaClient } from "../generated/prisma/client.js";
import { toCanonicalKrs } from "../client/endpoints.js";
import { parseCustomerId } from "./customer-id.js";

export type SearchEnrichedLeadsDeps = {
  db: PrismaClient;
};

const paramsSchema = z.object({
  customer_id: z.string().min(1),
  /**
   * PKD code prefix. Matches `pkd_glowny` (main activity). Use
   * broad prefixes like "62" (software/IT services) or "41" (budo-
   * wnictwo) to catch whole sectors; narrower prefixes like
   * "62.01" zero in on specific sub-codes.
   */
  pkdPrefix: z.string().min(1).max(10).optional(),
  /** Minimum przychody (revenue) in PLN, inclusive. */
  minRevenuePln: z.number().positive().optional(),
  /** Maximum przychody in PLN, inclusive. */
  maxRevenuePln: z.number().positive().optional(),
  /** Only consider statements from this year (defaults: any). */
  rocznik: z.number().int().min(2000).max(2100).optional(),
  /** Default: 20. Capped at 100 so the LLM doesn't accidentally
   *  blow the response token budget. */
  limit: z.number().int().min(1).max(100).optional().default(20),
  sortBy: z
    .enum(["revenue_desc", "revenue_asc", "recently_enriched"])
    .optional()
    .default("revenue_desc"),
});

type SearchEnrichedLeadsParams = z.infer<typeof paramsSchema>;

export type EnrichedLead = {
  krs: number;
  krsPadded: string;
  nip: string | null;
  nazwaPelna: string;
  pkdGlowny: string | null;
  formaPrawna: string | null;
  rocznik: number | null;
  przychody: number | null;
  zysk: number | null;
  aktywa: number | null;
  source: string;
  enrichedAt: string | null;
};

export type SearchEnrichedLeadsResult =
  | {
      success: true;
      total: number;
      leads: EnrichedLead[];
      filtersApplied: {
        pkdPrefix: string | null;
        minRevenuePln: number | null;
        maxRevenuePln: number | null;
        rocznik: number | null;
        sortBy: string;
        limit: number;
      };
    }
  | { success: false; error: string };

export async function handleSearchEnrichedLeads(
  input: SearchEnrichedLeadsParams,
  { db }: SearchEnrichedLeadsDeps,
): Promise<SearchEnrichedLeadsResult> {
  const { orgId } = parseCustomerId(input.customer_id);
  const limit = input.limit ?? 20;
  const sortBy = input.sortBy ?? "revenue_desc";

  try {
    // Build the financial-document predicate. We want only rows with
    // a real przychody number — skip 'unavailable' source rows since
    // their figures are null and would pollute results.
    const finDocWhere: Record<string, unknown> = {
      przychody: { not: null },
    };
    if (input.minRevenuePln != null || input.maxRevenuePln != null) {
      const range: Record<string, number> = {};
      if (input.minRevenuePln != null) {
        range.gte = input.minRevenuePln;
      }
      if (input.maxRevenuePln != null) {
        range.lte = input.maxRevenuePln;
      }
      finDocWhere.przychody = { ...range, not: null };
    }
    if (input.rocznik != null) {
      finDocWhere.rocznik = input.rocznik;
    }

    const companyWhere: Record<string, unknown> = {
      financialDocuments: { some: finDocWhere },
    };
    if (input.pkdPrefix) {
      // Match against the numeric PKD 2007 code stored in
      // `pkd_code` (e.g. "62.01.Z"). Descriptions in pkd_glowny
      // are the Polish text which can't be reliably prefix-matched.
      companyWhere.pkdCode = { startsWith: input.pkdPrefix };
    }

    const rows = await db.companyProfile.findMany({
      where: companyWhere,
      include: {
        financialDocuments: {
          where: finDocWhere,
          orderBy: { rocznik: "desc" },
          take: 1,
        },
      },
      take: limit,
      // Prisma doesn't support ORDER BY across an included relation,
      // so we over-fetch by `limit` and sort in memory. For small
      // `limit` (<=100) this is fine.
    });

    const leads: EnrichedLead[] = rows
      .map((row): EnrichedLead | null => {
        const fd = row.financialDocuments[0];
        if (!fd) {
          return null;
        }
        return {
          krs: row.krs,
          krsPadded: toCanonicalKrs(row.krs),
          nip: row.nip ?? null,
          nazwaPelna: row.nazwaPelna,
          pkdGlowny: row.pkdGlowny ?? null,
          formaPrawna: row.formaPrawna ?? null,
          rocznik: fd.rocznik ?? null,
          przychody: fd.przychody ?? null,
          zysk: fd.zysk ?? null,
          aktywa: fd.aktywa ?? null,
          source: fd.source,
          enrichedAt: fd.fetchedAt.toISOString(),
        };
      })
      .filter((l): l is EnrichedLead => l !== null);

    // Apply the requested sort here rather than in SQL (see above).
    leads.sort((a, b) => {
      if (sortBy === "recently_enriched") {
        return (b.enrichedAt ?? "").localeCompare(a.enrichedAt ?? "");
      }
      const av = a.przychody ?? -Infinity;
      const bv = b.przychody ?? -Infinity;
      return sortBy === "revenue_asc" ? av - bv : bv - av;
    });

    logger.info(
      { orgId, filters: input, returned: leads.length },
      "search_enriched_leads: query complete",
    );

    return {
      success: true,
      total: leads.length,
      leads,
      filtersApplied: {
        pkdPrefix: input.pkdPrefix ?? null,
        minRevenuePln: input.minRevenuePln ?? null,
        maxRevenuePln: input.maxRevenuePln ?? null,
        rocznik: input.rocznik ?? null,
        sortBy,
        limit,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, filters: input }, "search_enriched_leads failed");
    return { success: false, error: msg };
  }
}

export function registerSearchEnrichedLeads(
  mcp: FastMCP,
  deps: SearchEnrichedLeadsDeps,
): void {
  mcp.addTool({
    name: "search_enriched_leads",
    description:
      "Query the local cache of Polish companies previously fetched from " +
      "Rejestr.io. Filters by PKD prefix and revenue range. " +
      "Use this when the user asks \"pokaż leady z branży X z przychodem > Y\" " +
      "or similar aggregate questions. " +
      "IT sector = PKD prefix '62'. Budownictwo = '41'-'43'. Finanse = '64'-'66'. " +
      "Returns at most `limit` results (default 20, max 100) sorted by revenue. " +
      "NOT a substitute for `lookup_company` — this only finds matches among " +
      "companies previously fetched via get_krs_info / get_financials. " +
      "No upstream API cost. In Polish replies describe results as " +
      "\"firmy pobrane z Rejestr.io\" or \"zapisane w lokalnej bazie\", " +
      "never \"wzbogacone\" (ambiguous with \"enriched financially\").",
    parameters: paramsSchema,
    execute: async (input) =>
      JSON.stringify(await handleSearchEnrichedLeads(input, deps)),
  });
}
