/**
 * MCP tool: `get_financials`
 *
 * Return a revenue / profit / costs / assets time-series for a Polish
 * company. Two-tier strategy discovered during the contract probe
 * (2026-04-15) — documented in ragen-app docs/pl-registry-mcp.md.
 *
 * **Tier 1 (years=1, cheap)**: read `ostatnie_sprawozdanie.glowne_pola`
 * directly from endpoint 02's cached basic data. ~80%+ of SMEs have
 * this populated; effectively free once `get_krs_info` has run.
 *
 * **Tier 2 (years>1, or tier 1 empty)**: list filings via endpoint 10,
 * filter to `czy_ma_json: true` docs named "Roczne sprawozdanie
 * finansowe", fetch each year via endpoint 11 (0.50 PLN each). Cache
 * by `(krs, rocznik)`. Periods with no JSON-bearing doc yield an
 * `unavailable` slot — surfaced in the response so callers see the
 * gap explicitly rather than silently missing years.
 */
import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { logger } from "@ragen-mcp/core";
import type { RejestrioClient } from "../client/rejestrio-client.js";
import type { BudgetGuard } from "../audit/budget-guard.js";
import type { CompanyProfileRepository } from "../cache/company-profile-repo.js";
import type { FinancialDocumentRepository } from "../cache/financial-doc-repo.js";
import { ENDPOINTS, toApiKrs, toCanonicalKrs } from "../client/endpoints.js";
import { CACHE_TTL_MS, isFresh } from "../cache/ttl.js";
import { basicResponseSchema } from "../schemas/search.js";
import {
  extractHeadlineFigures,
  finDocListResponseSchema,
  finDocResponseSchema,
  pickJsonBearingAnnualReport,
} from "../schemas/financials.js";
import { parseCustomerId } from "./customer-id.js";

export type GetFinancialsDeps = {
  client: RejestrioClient;
  budget: BudgetGuard;
  profiles: CompanyProfileRepository;
  finDocs: FinancialDocumentRepository;
};

const paramsSchema = z.object({
  customer_id: z.string().min(1),
  krs: z
    .union([z.string(), z.number()])
    .refine((v) => /^\d{1,10}$/.test(String(v).replace(/^0+/, "") || "0"), {
      message: "KRS must be 1–10 digits",
    }),
  years: z.number().int().positive().max(5).optional().default(1),
});

type GetFinancialsParams = z.infer<typeof paramsSchema>;

type StatementSource = "basic_snapshot" | "fin_document" | "unavailable";

export type Statement = {
  rocznik: number | null;
  source: StatementSource;
  przychody?: number | null;
  koszty?: number | null;
  zysk?: number | null;
  aktywa?: number | null;
  pasywa?: number | null;
  podatek?: number | null;
  documentId?: number | null;
  reason?: string;
};

export type GetFinancialsSuccess = {
  success: true;
  krs: number;
  krsPadded: string;
  statements: Statement[];
  /** Tier used to serve the MOST RECENT year. Diagnostic. */
  tierUsed: "tier_1" | "tier_2" | "mixed";
};

export type GetFinancialsError = {
  success: false;
  error: string;
};

export async function handleGetFinancials(
  input: GetFinancialsParams,
  { client, budget, profiles, finDocs }: GetFinancialsDeps,
): Promise<GetFinancialsSuccess | GetFinancialsError> {
  const krsNum = Number(String(input.krs).replace(/^0+/, "") || "0");
  const krsApi = toApiKrs(krsNum);
  const krsPadded = toCanonicalKrs(krsNum);
  const years = input.years ?? 1;
  const { orgId, userId } = parseCustomerId(input.customer_id);
  const ctx = { orgId, userId, krs: krsNum };

  try {
    // Worst-case: endpoint 02 + 10 + years × endpoint 11.
    const worstCase =
      ENDPOINTS["02"].costPln +
      ENDPOINTS["10"].costPln +
      years * ENDPOINTS["11"].costPln;
    await budget.assertAllowed(orgId, worstCase);

    // --- ensure basic profile is available (drives tier 1) ---
    const basic = await ensureBasic({
      client,
      profiles,
      krs: krsNum,
      krsApi,
      ctx,
    });
    if ("error" in basic) {
      return { success: false, error: basic.error };
    }
    const { basicResponse } = basic;

    // --- tier 1 fast path for years=1 ---
    if (years === 1) {
      const tier1 = extractTier1(basicResponse);
      if (tier1) {
        // Mirror the snapshot into `financial_documents` so the table
        // reflects all known financials regardless of which path
        // served the data. Before this, tier-1 hits stayed only in
        // `company_profiles.basic_raw` and the user wondered why
        // `financial_documents` was empty despite many calls. The
        // mirror is idempotent — upsert keyed by (krs, rocznik).
        await persistTier1Snapshot(finDocs, krsNum, tier1);
        return {
          success: true,
          krs: krsNum,
          krsPadded,
          tierUsed: "tier_1",
          statements: [tier1],
        };
      }
    }

    // --- tier 2 path ---
    const listRaw = await client.get(
      "10",
      `/org/${krsApi}/krs-dokumenty`,
      undefined,
      ctx,
    );
    const listParsed = finDocListResponseSchema.safeParse(listRaw);
    if (!listParsed.success) {
      logger.error(
        { krs: krsNum, issues: listParsed.error.issues.slice(0, 5) },
        "get_financials: endpoint 10 response failed schema validation",
      );
      return {
        success: false,
        error: "Unexpected financial-doc-list shape from Rejestr.io",
      };
    }

    // Periods are returned most-recent-first by the API. Take the
    // top N (most recent `years` periods).
    const periods = listParsed.data.slice(0, years);
    const statements: Statement[] = [];

    // The tier-1 snapshot from basic-data can fill in the latest
    // year even when endpoint 10 is asked to cover several years —
    // we then skip its endpoint 11 call. Pre-compute once.
    const tier1Snapshot = extractTier1(basicResponse);

    for (const period of periods) {
      const rocznik =
        deriveRocznik(period.data_start, period.data_koniec) ?? null;

      // Opportunistic tier-1 fill for the latest year.
      if (
        tier1Snapshot &&
        rocznik != null &&
        tier1Snapshot.rocznik === rocznik
      ) {
        // Mirror for the same reason as the fast-path above.
        await persistTier1Snapshot(finDocs, krsNum, tier1Snapshot);
        statements.push(tier1Snapshot);
        continue;
      }

      // Cache hit?
      if (rocznik != null) {
        const fresh = await finDocs.isRocznikFresh(krsNum, rocznik);
        if (fresh) {
          const cached = await loadCachedRocznik(finDocs, krsNum, rocznik);
          if (cached) {
            statements.push(cached);
            continue;
          }
        }
      }

      const candidate = pickJsonBearingAnnualReport(period);
      if (!candidate) {
        const entry: Statement = {
          rocznik,
          source: "unavailable",
          reason: "no_czy_ma_json_document_in_period",
        };
        if (rocznik != null) {
          await finDocs.upsert({
            companyKrs: krsNum,
            rocznik,
            dataOd: parseDateOrNull(period.data_start),
            dataDo: parseDateOrNull(period.data_koniec),
            documentId: null,
            czyMaJson: false,
            source: "unavailable",
            rawPayload: null,
          });
        }
        statements.push(entry);
        continue;
      }

      const docId = Number(candidate.id);
      const raw = await client.get(
        "11",
        `/org/${krsApi}/krs-dokumenty/${docId}`,
        undefined,
        { ...ctx },
      );
      const parsed = finDocResponseSchema.safeParse(raw);
      if (!parsed.success) {
        logger.error(
          { krs: krsNum, docId, issues: parsed.error.issues.slice(0, 5) },
          "get_financials: endpoint 11 response failed schema validation",
        );
        statements.push({
          rocznik,
          source: "unavailable",
          reason: "schema_mismatch",
          documentId: docId,
        });
        continue;
      }

      if (parsed.data === null || typeof parsed.data === "string") {
        // Either czy_ma_json was lying (null), or the upstream
        // returned a raw XHTML/XML string we can't parse from the
        // MCP layer. Both cases cache as unavailable so we don't
        // re-pay 0.50 PLN discovering the same thing next turn.
        const reason =
          parsed.data === null
            ? "endpoint_11_returned_null"
            : "endpoint_11_returned_non_json_string";
        if (rocznik != null) {
          await finDocs.upsert({
            companyKrs: krsNum,
            rocznik,
            dataOd: parseDateOrNull(period.data_start),
            dataDo: parseDateOrNull(period.data_koniec),
            documentId: docId,
            czyMaJson: true,
            source: "unavailable",
            rawPayload: parsed.data ?? null,
            fetchedAt: new Date(),
          });
        }
        statements.push({
          rocznik,
          source: "unavailable",
          reason,
          documentId: docId,
        });
        continue;
      }

      const figures = extractHeadlineFigures(parsed.data) ?? {};
      if (rocznik != null) {
        await finDocs.upsert({
          companyKrs: krsNum,
          rocznik,
          dataOd: parseDateOrNull(period.data_start),
          dataDo: parseDateOrNull(period.data_koniec),
          documentId: docId,
          czyMaJson: true,
          source: "fin_document",
          rawPayload: parsed.data,
          przychody: figures.przychody,
          koszty: figures.koszty,
          zysk: figures.zysk,
          aktywa: figures.aktywa,
          pasywa: figures.pasywa,
          podatek: figures.podatek,
        });
      }
      statements.push({
        rocznik,
        source: "fin_document",
        documentId: docId,
        ...figures,
      });
    }

    const tierUsed = inferTier(statements);
    return {
      success: true,
      krs: krsNum,
      krsPadded,
      statements,
      tierUsed,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, krs: krsNum }, "get_financials failed");
    return { success: false, error: msg };
  }
}

// --- helpers ---

async function ensureBasic(args: {
  client: RejestrioClient;
  profiles: CompanyProfileRepository;
  krs: number;
  krsApi: string;
  ctx: { orgId: string | null; userId: string | null; krs: number };
}): Promise<
  | { basicResponse: z.infer<typeof basicResponseSchema> }
  | { error: string }
> {
  const existing = await args.profiles.getFreshByKrs(
    args.krs,
    Number.POSITIVE_INFINITY,
  );
  let raw: unknown;
  if (existing && isFresh(existing.basicFetchedAt, CACHE_TTL_MS.krsInfo)) {
    raw = existing.basicRaw;
  } else {
    raw = await args.client.get(
      "02",
      `/org/${args.krsApi}`,
      undefined,
      args.ctx,
    );
  }
  const parsed = basicResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: "Unexpected basic-data response shape from Rejestr.io",
    };
  }
  if (!existing || !isFresh(existing.basicFetchedAt, CACHE_TTL_MS.krsInfo)) {
    await args.profiles.upsertBasic(
      args.krs,
      {
        id: Number(parsed.data.id),
        nip: parsed.data.numery.nip,
        regon: parsed.data.numery.regon,
        nazwaPelna: parsed.data.nazwy.pelna,
        nazwaSkrocona: parsed.data.nazwy.skrocona,
        formaPrawna: parsed.data.stan?.forma_prawna,
        pkdGlowny: parsed.data.stan?.pkd_przewazajace_dzial,
        raw,
      },
      new Date(),
    );
  }
  return { basicResponse: parsed.data };
}

function extractTier1(
  basic: z.infer<typeof basicResponseSchema>,
): Statement | null {
  type SprShape = {
    rocznik?: number;
    glowne_pola?: {
      przychody?: { wartosc?: number };
      koszty?: { wartosc?: number };
      zysk?: { wartosc?: number };
      aktywa?: { wartosc?: number };
      pasywa?: { wartosc?: number };
      podatek_dochodowy?: { wartosc?: number };
    };
  };
  const spr = (basic as unknown as { ostatnie_sprawozdanie?: SprShape })
    .ostatnie_sprawozdanie;
  if (!spr?.glowne_pola) {
    return null;
  }
  return {
    rocznik: spr.rocznik ?? null,
    source: "basic_snapshot",
    przychody: spr.glowne_pola.przychody?.wartosc,
    koszty: spr.glowne_pola.koszty?.wartosc,
    zysk: spr.glowne_pola.zysk?.wartosc,
    aktywa: spr.glowne_pola.aktywa?.wartosc,
    pasywa: spr.glowne_pola.pasywa?.wartosc,
    podatek: spr.glowne_pola.podatek_dochodowy?.wartosc,
  };
}

/**
 * Mirror a tier-1 (basic-snapshot) result into `financial_documents`.
 *
 * Idempotent: the repository upsert is keyed by (krs, rocznik), so
 * calling this repeatedly for the same year just refreshes the row's
 * `fetched_at`. Silently no-ops when rocznik is missing — we can't
 * key the row otherwise and the same record will land next time a
 * year-aware call fires.
 *
 * Failures are swallowed with a log line. The caller (chat turn)
 * must NOT fail just because a best-effort mirror write went wrong.
 */
async function persistTier1Snapshot(
  finDocs: FinancialDocumentRepository,
  companyKrs: number,
  tier1: Statement,
): Promise<void> {
  if (tier1.rocznik == null) {
    return;
  }
  try {
    await finDocs.upsert({
      companyKrs,
      rocznik: tier1.rocznik,
      documentId: null,
      czyMaJson: false,
      source: "basic_snapshot",
      rawPayload: null,
      przychody: tier1.przychody ?? null,
      koszty: tier1.koszty ?? null,
      zysk: tier1.zysk ?? null,
      aktywa: tier1.aktywa ?? null,
      pasywa: tier1.pasywa ?? null,
      podatek: tier1.podatek ?? null,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), companyKrs },
      "persistTier1Snapshot: mirror write failed (best-effort, not user-facing)",
    );
  }
}

async function loadCachedRocznik(
  finDocs: FinancialDocumentRepository,
  companyKrs: number,
  rocznik: number,
): Promise<Statement | null> {
  const rows = await finDocs.findByKrs(companyKrs);
  const row = rows.find((r) => r.rocznik === rocznik);
  if (!row) {
    return null;
  }
  return {
    rocznik: row.rocznik,
    source: row.source as StatementSource,
    przychody: row.przychody,
    koszty: row.koszty,
    zysk: row.zysk,
    aktywa: row.aktywa,
    pasywa: row.pasywa,
    podatek: row.podatek,
    documentId: row.documentId,
  };
}

function deriveRocznik(
  dataStart?: string,
  dataKoniec?: string,
): number | undefined {
  // A calendar-year period starts Jan 1 and ends Dec 31 of the same
  // year. Otherwise we'd need `rocznik_przybliżony`, which isn't
  // part of endpoint 10's response — fall back to Dec-31 year.
  if (dataStart?.endsWith("-01-01") && dataKoniec?.endsWith("-12-31")) {
    const a = dataStart.slice(0, 4);
    const b = dataKoniec.slice(0, 4);
    if (a === b) {
      return Number(a);
    }
  }
  if (dataKoniec) {
    const y = Number(dataKoniec.slice(0, 4));
    if (Number.isFinite(y)) {
      return y;
    }
  }
  return undefined;
}

function parseDateOrNull(s: string | undefined): Date | null {
  if (!s) {
    return null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inferTier(statements: Statement[]): GetFinancialsSuccess["tierUsed"] {
  if (statements.length === 0) {
    return "tier_2";
  }
  const first = statements[0];
  const others = statements.slice(1);
  const latestIsTier1 = first.source === "basic_snapshot";
  if (latestIsTier1 && others.every((s) => s.source === "basic_snapshot")) {
    return "tier_1";
  }
  if (!latestIsTier1 && others.every((s) => s.source !== "basic_snapshot")) {
    return "tier_2";
  }
  return "mixed";
}

export function registerGetFinancials(
  mcp: FastMCP,
  deps: GetFinancialsDeps,
): void {
  mcp.addTool({
    name: "get_financials",
    description:
      "Fetch revenue/profit/costs/assets for a Polish company across up to 5 years. " +
      "Cheap when `years=1` (reads the cached inline snapshot from basic-data — ~0 PLN). " +
      "Expensive for historical series (up to 0.50 PLN per year from endpoint 11). " +
      "Periods without a JSON-bearing annual filing return as `source: 'unavailable'` — " +
      "especially common for GPW-listed and consolidated filers. " +
      "Pass KRS id (either padded or unpadded).",
    parameters: paramsSchema,
    execute: async (input) =>
      JSON.stringify(await handleGetFinancials(input, deps)),
  });
}
