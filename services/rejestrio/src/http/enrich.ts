/**
 * HTTP enrichment endpoint for ragen-app's leads pipeline.
 *
 * Composes existing MCP tool handlers (`handleLookupCompany`,
 * `handleGetKrsInfo`, `handleGetFinancials`) and flattens the result
 * into a single enrichment payload keyed for tabular storage on the
 * caller side. Caching, audit logging, and the daily-budget guard
 * apply because we delegate to the same handlers as the MCP tools.
 */
import { Hono } from "hono";
import { z } from "zod";
import { logger } from "@ragen-connectors/core";
import type { RejestrioClient } from "../client/rejestrio-client.js";
import type { BudgetGuard } from "../audit/budget-guard.js";
import type { CompanyProfileRepository } from "../cache/company-profile-repo.js";
import type { FinancialDocumentRepository } from "../cache/financial-doc-repo.js";
import { handleLookupCompany } from "../tools/lookup-company.js";
import { handleGetKrsInfo } from "../tools/get-krs-info.js";
import { handleGetFinancials } from "../tools/get-financials.js";
import { enrichAuthMiddleware } from "./auth.js";

export type EnrichDeps = {
  client: RejestrioClient;
  budget: BudgetGuard;
  profiles: CompanyProfileRepository;
  finDocs: FinancialDocumentRepository;
};

const enrichBodySchema = z
  .object({
    customerId: z.string().min(1),
    nip: z.string().regex(/^\d{10}$/).optional(),
    krs: z
      .union([z.string(), z.number()])
      .refine((v) => /^\d{1,10}$/.test(String(v)), "krs must be 1–10 digits")
      .optional(),
    name: z.string().min(2).max(200).optional(),
    includeFinancials: z.boolean().optional().default(false),
  })
  .refine(
    (v) => [v.nip, v.krs, v.name].filter((x) => x != null && x !== "").length === 1,
    { message: "provide exactly one of: nip, krs, name" },
  );

export type EnrichRequest = z.infer<typeof enrichBodySchema>;

export type EnrichmentPayload = {
  /** Canonical 10-digit KRS string. */
  krs: string;
  nip: string | null;
  regon: string | null;
  nazwaPelna: string;
  nazwaSkrocona: string | null;
  formaPrawna: string | null;
  pkdGlowny: string | null;
  miejscowosc: string | null;
  kodPocztowy: string | null;
  wykreslona: boolean;
  wUpadlosci: boolean;
  wLikwidacji: boolean;
  /** Most recent revenue in PLN (przychody). Null if not filed/available. */
  przychodyPln: number | null;
  zyskPln: number | null;
  aktywaPln: number | null;
  /** Year of the financial statement referenced by przychody/zysk/aktywa. */
  sprawozdanieRocznik: number | null;
};

export type EnrichResponse =
  | { success: true; matched: { source: "krs" | "nip" | "name"; via?: string }; data: EnrichmentPayload }
  | { success: false; error: string; code: "not_found" | "ambiguous" | "upstream" | "invalid" };

export async function handleEnrichCompany(
  input: EnrichRequest,
  deps: EnrichDeps,
): Promise<EnrichResponse> {
  let krs: string | number | null = input.krs ?? null;
  let matchSource: "krs" | "nip" | "name" = "krs";
  let via: string | undefined;

  if (krs == null) {
    const lookup = await handleLookupCompany(
      {
        customer_id: input.customerId,
        nip: input.nip,
        nazwa: input.name,
      },
      { client: deps.client, budget: deps.budget },
    );
    if (!lookup.success) {
      return { success: false, error: lookup.error, code: "upstream" };
    }
    if (lookup.results.length === 0) {
      return { success: false, error: "No matching company found", code: "not_found" };
    }
    // For NIP search the API returns at most one hit; for name search we
    // take the top result. The caller can disambiguate later by passing
    // a KRS directly if our top pick was wrong.
    const top = lookup.results[0]!;
    krs = top.krs;
    matchSource = input.nip ? "nip" : "name";
    via = `lookup:${top.krsPadded}`;
  }

  const info = await handleGetKrsInfo(
    { customer_id: input.customerId, krs: krs! },
    deps,
  );
  if (!info.success) {
    return { success: false, error: info.error, code: "upstream" };
  }

  let przychody: number | null = info.ostatnieSprawozdanie?.przychody ?? null;
  let zysk: number | null = info.ostatnieSprawozdanie?.zysk ?? null;
  let aktywa: number | null = info.ostatnieSprawozdanie?.aktywa ?? null;
  let rocznik: number | null = info.ostatnieSprawozdanie?.rocznik ?? null;

  if (input.includeFinancials && przychody == null) {
    // Fall back to endpoint 10+11 when basic-data didn't carry a
    // tier-1 snapshot (older filers, NGOs, recently wykreślone).
    const fin = await handleGetFinancials(
      { customer_id: input.customerId, krs: info.krs, years: 1 },
      deps,
    );
    if (fin.success && fin.statements[0]) {
      const s = fin.statements[0];
      przychody = s.przychody ?? null;
      zysk = s.zysk ?? null;
      aktywa = s.aktywa ?? null;
      rocznik = s.rocznik ?? null;
    } else if (!fin.success) {
      // Non-fatal — return the profile we have, log the financials gap.
      logger.warn(
        { krs: info.krs, error: fin.error },
        "enrich: financials fallback failed; returning profile only",
      );
    }
  }

  return {
    success: true,
    matched: { source: matchSource, via },
    data: {
      krs: info.krsPadded,
      nip: info.nip,
      regon: info.regon,
      nazwaPelna: info.nazwaPelna,
      nazwaSkrocona: info.nazwaSkrocona,
      formaPrawna: info.formaPrawna,
      pkdGlowny: info.pkdGlowny,
      miejscowosc: info.siedziba.miejscowosc,
      kodPocztowy: info.siedziba.kod,
      wykreslona: info.stan.wykreslona,
      wUpadlosci: info.stan.wUpadlosci,
      wLikwidacji: info.stan.wLikwidacji,
      przychodyPln: przychody,
      zyskPln: zysk,
      aktywaPln: aktywa,
      sprawozdanieRocznik: rocznik,
    },
  };
}

export function createEnrichRouter(secret: string, deps: EnrichDeps): Hono {
  const router = new Hono();
  router.use("*", enrichAuthMiddleware(secret));

  router.post("/company", async (c) => {
    const raw = c.get("rawBody" as never) as string | undefined;
    let parsedJson: unknown;
    try {
      parsedJson = raw ? JSON.parse(raw) : await c.req.json();
    } catch {
      return c.json(
        { success: false, error: "invalid JSON body", code: "invalid" },
        400,
      );
    }
    const parsed = enrichBodySchema.safeParse(parsedJson);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: parsed.error.issues.map((i) => i.message).join("; "),
          code: "invalid",
        } satisfies EnrichResponse,
        400,
      );
    }
    const result = await handleEnrichCompany(parsed.data, deps);
    const status = result.success
      ? 200
      : result.code === "not_found"
        ? 404
        : result.code === "invalid"
          ? 400
          : 502;
    return c.json(result, status);
  });

  return router;
}
