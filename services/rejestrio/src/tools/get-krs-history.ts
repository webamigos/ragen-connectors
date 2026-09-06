/**
 * MCP tool: `get_krs_history`
 *
 * Pulls the HISTORICAL powiązania for a KRS entry — board members,
 * shareholders, and related entities that appeared in past KRS
 * filings but are no longer in the latest entry.
 *
 * The answer to the use case "who was on the board before this
 * company was wykreślona?" Current-only powiązania (endpoint 06
 * default) return `[]` for wykreślone entities; this tool calls
 * endpoint 06 with `aktualnosc=historyczne` which surfaces the
 * historical record.
 *
 * Plan requirement: Rejestr.io Premium or higher. Base plan
 * responses will 403; the client surfaces that as
 * RejestrioPlanTierError.
 *
 * Cost: 0.05 PLN per uncached call. Cached in
 * `CompanyProfile.powiazaniaHistoryczneRaw` with the standard
 * `krsInfo` TTL (30 days).
 */
import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { logger } from "@ragen-connectors/core";
import type { RejestrioClient } from "../client/rejestrio-client.js";
import type { BudgetGuard } from "../audit/budget-guard.js";
import type { CompanyProfileRepository } from "../cache/company-profile-repo.js";
import { ENDPOINTS, toApiKrs, toCanonicalKrs } from "../client/endpoints.js";
import { CACHE_TTL_MS, isFresh } from "../cache/ttl.js";
import { powiazaniaResponseSchema } from "../schemas/powiazania.js";
import { parseCustomerId } from "./customer-id.js";

export type GetKrsHistoryDeps = {
  client: RejestrioClient;
  budget: BudgetGuard;
  profiles: CompanyProfileRepository;
};

const paramsSchema = z.object({
  customer_id: z.string().min(1),
  krs: z
    .union([z.string(), z.number()])
    .refine((v) => /^\d{1,10}$/.test(String(v).replace(/^0+/, "") || "0"), {
      message: "KRS must be 1–10 digits",
    }),
});

type GetKrsHistoryParams = z.infer<typeof paramsSchema>;

type HistoricalPowiazanie = {
  id: number | string;
  typ: string;
  imionaI_nazwisko?: string;
  nazwa?: string;
  /**
   * When this relationship ended. Historical by definition, but the
   * concrete date lets the model answer "who was on the board during
   * 2019?" by filtering date ranges.
   */
  dataKoniec?: string | null;
  dataStart?: string;
  kierunek?: string;
  linkTyp?: string;
};

export type GetKrsHistorySuccess = {
  success: true;
  krs: number;
  krsPadded: string;
  source: "cache" | "upstream";
  powiazaniaHistoryczne: HistoricalPowiazanie[];
};

export type GetKrsHistoryError = {
  success: false;
  error: string;
};

export async function handleGetKrsHistory(
  input: GetKrsHistoryParams,
  { client, budget, profiles }: GetKrsHistoryDeps,
): Promise<GetKrsHistorySuccess | GetKrsHistoryError> {
  const krsNum = Number(String(input.krs).replace(/^0+/, "") || "0");
  const krsApi = toApiKrs(krsNum);
  const krsPadded = toCanonicalKrs(krsNum);
  const { orgId, userId } = parseCustomerId(input.customer_id);
  const ctx = { orgId, userId, krs: krsNum };

  try {
    await budget.assertAllowed(orgId, ENDPOINTS["06"].costPln);

    // Cache check first. We peek at the existing row regardless of
    // the other sections' freshness — the historical endpoint is
    // independent.
    const existing = await profiles.getFreshByKrs(
      krsNum,
      Number.POSITIVE_INFINITY,
    );

    let raw: unknown;
    let source: "cache" | "upstream";

    if (
      existing &&
      isFresh(existing.powiazaniaHistoryczneFetchedAt, CACHE_TTL_MS.krsInfo)
    ) {
      raw = existing.powiazaniaHistoryczneRaw;
      source = "cache";
    } else {
      raw = await client.get(
        "06",
        `/org/${krsApi}/krs-powiazania`,
        { aktualnosc: "historyczne" },
        ctx,
      );
      source = "upstream";
    }

    const parsed = powiazaniaResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { krs: krsNum, issues: parsed.error.issues.slice(0, 5) },
        "get_krs_history: endpoint 06 (historyczne) response failed schema validation",
      );
      return {
        success: false,
        error: "Unexpected historical powiązania response shape from Rejestr.io",
      };
    }

    // Only persist when the row already exists — avoids nested create
    // logic here, and in practice a caller asking for history almost
    // always ran `get_krs_info` first which seeds the row.
    if (source === "upstream" && existing) {
      await profiles.upsertPowiazaniaHistoryczne(krsNum, raw, new Date());
    }

    const flattened: HistoricalPowiazanie[] = parsed.data.flatMap(
      (entry): HistoricalPowiazanie[] => {
        const tozsamosc = (entry.tozsamosc ?? {}) as {
          imiona_i_nazwisko?: string;
          nazwa?: string;
        };
        const links = entry.krs_powiazania_kwerendowane ?? [];
        if (links.length === 0) {
          return [
            {
              id: entry.id as number | string,
              typ: entry.typ,
              imionaI_nazwisko: tozsamosc.imiona_i_nazwisko,
              nazwa: tozsamosc.nazwa,
              dataKoniec: null,
            },
          ];
        }
        return links.map((link) => ({
          id: entry.id as number | string,
          typ: entry.typ,
          imionaI_nazwisko: tozsamosc.imiona_i_nazwisko,
          nazwa: tozsamosc.nazwa,
          dataKoniec: link.data_koniec ?? null,
          dataStart: link.data_start,
          kierunek: link.kierunek,
          linkTyp: link.typ,
        }));
      },
    );

    return {
      success: true,
      krs: krsNum,
      krsPadded,
      source,
      powiazaniaHistoryczne: flattened,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, krs: krsNum }, "get_krs_history failed");
    return { success: false, error: msg };
  }
}

export function registerGetKrsHistory(
  mcp: FastMCP,
  deps: GetKrsHistoryDeps,
): void {
  mcp.addTool({
    name: "get_krs_history",
    description:
      "Fetch HISTORICAL board members, shareholders, and connections for a Polish company by KRS id — " +
      "entries that appeared in past KRS filings but are no longer in the current record. " +
      "Use this when `get_krs_info` returns empty `powiazania` (typical for wykreślone companies) " +
      "OR when the user explicitly asks about past zarząd / udziałowcy. " +
      "Requires Rejestr.io Premium plan. Cost: 0.05 PLN per call (cached 30 days).",
    parameters: paramsSchema,
    execute: async (input) =>
      JSON.stringify(await handleGetKrsHistory(input, deps)),
  });
}
