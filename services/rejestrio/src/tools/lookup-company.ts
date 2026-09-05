/**
 * MCP tool: `lookup_company`
 *
 * Resolve a Polish company by NIP, REGON, or fragment of the name.
 * Returns up to 10 candidate organizations with their KRS id, name,
 * legal form, city, and current state flags — enough for the chat
 * assistant to pick one and hand the KRS to `get_krs_info`.
 *
 * Search results are NOT cached. The input space is too large and
 * cache hit rate for free-text `nazwa` queries would be near zero.
 * Specific-entity calls (endpoint 02/03/06) are cached by KRS in
 * `CompanyProfileRepository`.
 *
 * Cost: 0.05 PLN per call, regardless of result count.
 */
import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { logger } from "@ragen-connectors/core";
import type { RejestrioClient } from "../client/rejestrio-client.js";
import type { BudgetGuard } from "../audit/budget-guard.js";
import { ENDPOINTS } from "../client/endpoints.js";
import { searchResponseSchema } from "../schemas/search.js";
import { parseCustomerId } from "./customer-id.js";

export type LookupCompanyDeps = {
  client: RejestrioClient;
  budget: BudgetGuard;
};

const paramsSchema = z
  .object({
    /**
     * MCP caller context — the chat assistant's org / user. Used
     * for cost attribution in the audit log. Format matches the
     * ragen-connectors convention used by the google/clickup/hubspot
     * services: `{orgId}:{userId}:{provider}`.
     *
     * Unlike Google (per-user OAuth), Rejestr.io uses a single
     * service-wide API key — the customer_id here is audit-only,
     * not auth.
     */
    customer_id: z.string().min(1),

    /**
     * Exactly one of `nip`, `regon`, `nazwa` must be provided. The
     * Zod `.refine()` below enforces this rather than trying to
     * express "exactly one of N" in the schema itself, which is
     * verbose and hurts the error message.
     */
    nip: z.string().regex(/^\d{10}$/, "NIP must be exactly 10 digits").optional(),
    regon: z.string().regex(/^\d{9}(\d{5})?$/, "REGON must be 9 or 14 digits").optional(),
    nazwa: z.string().min(2).max(200).optional(),
  })
  .refine(
    (v) => {
      const n = [v.nip, v.regon, v.nazwa].filter(Boolean).length;
      return n === 1;
    },
    {
      message: "Provide exactly one of: nip, regon, nazwa",
    },
  );

type SearchResult = z.infer<typeof searchResponseSchema>["wyniki"][number];

type ToolResult = {
  success: true;
  results: Array<{
    krs: number;
    krsPadded: string;
    nip: string | null;
    regon: string | null;
    nazwaPelna: string;
    nazwaSkrocona: string | null;
    formaPrawna: string | null;
    pkdGlowny: string | null;
    siedziba: {
      miejscowosc: string | null;
      kod: string | null;
    };
    wykreslona: boolean;
    wUpadlosci: boolean;
    wLikwidacji: boolean;
  }>;
  totalFound: number;
};

type ToolErrorResult = {
  success: false;
  error: string;
};

function normalizeResult(hit: SearchResult) {
  const krsRaw = hit.numery?.krs ?? hit.id;
  const krs = typeof krsRaw === "number" ? krsRaw : Number(krsRaw);
  const krsPadded = String(krs).padStart(10, "0");
  return {
    krs,
    krsPadded,
    nip: hit.numery?.nip != null ? String(hit.numery.nip) : null,
    regon: hit.numery?.regon != null ? String(hit.numery.regon) : null,
    nazwaPelna: hit.nazwy.pelna,
    nazwaSkrocona: hit.nazwy.skrocona ?? null,
    formaPrawna: hit.stan?.forma_prawna ?? null,
    pkdGlowny: hit.stan?.pkd_przewazajace_dzial ?? null,
    siedziba: {
      miejscowosc: hit.adres?.miejscowosc ?? null,
      kod: hit.adres?.kod ?? null,
    },
    wykreslona: hit.stan?.czy_wykreslona ?? false,
    wUpadlosci: hit.stan?.w_upadlosci ?? false,
    wLikwidacji: hit.stan?.w_likwidacji ?? false,
  };
}

type LookupCompanyParams = z.infer<typeof paramsSchema>;

/**
 * Exported for direct unit testing without FastMCP ceremony. The
 * registered tool below just calls this.
 */
export async function handleLookupCompany(
  input: LookupCompanyParams,
  { client, budget }: LookupCompanyDeps,
): Promise<ToolResult | ToolErrorResult> {
  const query: Record<string, string> = {};
  if (input.nip) {
    query.nip = input.nip;
  } else if (input.regon) {
    query.regon = input.regon;
  } else if (input.nazwa) {
    query.nazwa = input.nazwa;
  }
  query.ile_na_strone = "10";

  const { orgId, userId } = parseCustomerId(input.customer_id);

  try {
    await budget.assertAllowed(orgId, ENDPOINTS["01"].costPln);

    const raw = await client.get(
      "01",
      "/org",
      query,
      { orgId, userId, nip: input.nip ?? null },
    );
    const parsed = searchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      // Permissive schemas on purpose — a failure here likely means
      // API drift. Log loud and surface a generic error to the caller
      // so the tool stays usable while we investigate.
      logger.error(
        { issues: parsed.error.issues.slice(0, 5) },
        "lookup_company: Rejestr.io response failed schema validation",
      );
      return {
        success: false,
        error: "Unexpected response shape from Rejestr.io",
      };
    }

    return {
      success: true,
      results: parsed.data.wyniki.map(normalizeResult),
      totalFound: parsed.data.liczba_wszystkich_wynikow,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "lookup_company failed");
    return {
      success: false,
      error: msg,
    };
  }
}

export function registerLookupCompany(
  mcp: FastMCP,
  deps: LookupCompanyDeps,
): void {
  mcp.addTool({
    name: "lookup_company",
    description:
      "Search for a Polish company in the KRS registry by NIP, REGON, or name fragment. " +
      "Returns up to 10 candidates with KRS id, names, legal form, city, and state flags. " +
      "Cost: 0.05 PLN per call. " +
      "Call this first when the user gives you a company reference but no KRS id.",
    parameters: paramsSchema,
    execute: async (input) =>
      JSON.stringify(await handleLookupCompany(input, deps)),
  });
}
