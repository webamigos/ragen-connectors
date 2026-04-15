/**
 * MCP tool: `get_krs_info`
 *
 * Pull the KRS snapshot for a Polish company by KRS id: basic details
 * (name, PKD, siedziba, state flags), advanced general chapter
 * (ogolny), and current related entities (zarząd, udziałowcy,
 * powiązania). Composed from Rejestr.io endpoints 02 + 03 + 06.
 *
 * Caching is per-section with independent TTLs. If only one section
 * has gone stale, only that endpoint is re-fetched. Fresh sections
 * serve from cache (0 PLN).
 *
 * Cost when fully cold: 3 × 0.05 = 0.15 PLN.
 * Cost when fully cached: 0 PLN.
 *
 * The caller must supply a KRS. If you only have a NIP, run
 * `lookup_company` first and then pass the resulting KRS here.
 */
import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { logger } from "@ragen-mcp/core";
import type { RejestrioClient } from "../client/rejestrio-client.js";
import type { BudgetGuard } from "../audit/budget-guard.js";
import type { CompanyProfileRepository } from "../cache/company-profile-repo.js";
import { ENDPOINTS, toApiKrs, toCanonicalKrs } from "../client/endpoints.js";
import { CACHE_TTL_MS, isFresh } from "../cache/ttl.js";
import {
  basicResponseSchema,
  type BasicResponse,
} from "../schemas/search.js";
import {
  advancedResponseSchema,
  isAdvancedEmpty,
} from "../schemas/advanced.js";
import { powiazaniaResponseSchema } from "../schemas/powiazania.js";
import { parseCustomerId } from "./customer-id.js";

export type GetKrsInfoDeps = {
  client: RejestrioClient;
  budget: BudgetGuard;
  profiles: CompanyProfileRepository;
};

const paramsSchema = z.object({
  customer_id: z.string().min(1),
  /**
   * KRS can be given either as the 10-digit canonical form
   * (`"0000010681"`) or without leading zeros (`"10681"` / `10681`).
   * We normalise to the integer form for cache keys and the API URL.
   */
  krs: z
    .union([z.string(), z.number()])
    .refine((v) => /^\d{1,10}$/.test(String(v).replace(/^0+/, "") || "0"), {
      message: "KRS must be 1–10 digits",
    }),
});

type GetKrsInfoParams = z.infer<typeof paramsSchema>;

type GlowneSprawozdanie = {
  rocznik?: number;
  dataOd?: string;
  dataDo?: string;
  przychody?: number;
  koszty?: number;
  zysk?: number;
  aktywa?: number;
  pasywa?: number;
  podatek?: number;
};

type Powiazanie = {
  id: number | string;
  typ: string;
  imionaI_nazwisko?: string;
  nazwa?: string;
  kierunek?: string;
  aktywne: boolean;
};

export type GetKrsInfoSuccess = {
  success: true;
  krs: number;
  krsPadded: string;
  nip: string | null;
  regon: string | null;
  nazwaPelna: string;
  nazwaSkrocona: string | null;
  formaPrawna: string | null;
  pkdGlowny: string | null;
  siedziba: { miejscowosc: string | null; kod: string | null };
  stan: {
    wykreslona: boolean;
    wUpadlosci: boolean;
    wLikwidacji: boolean;
    wZawieszeniu: boolean;
    naGpw: boolean;
  };
  ostatnieSprawozdanie: GlowneSprawozdanie | null;
  /** True when endpoint 03 had no chapter data (wykreślone / upadłe). */
  advancedEmpty: boolean;
  powiazania: Powiazanie[];
  sources: {
    basic: "cache" | "upstream";
    advanced: "cache" | "upstream";
    powiazania: "cache" | "upstream";
  };
};

export type GetKrsInfoError = {
  success: false;
  error: string;
};

/**
 * Exported for direct unit testing — the registered tool just wraps
 * this in FastMCP's JSON-stringification.
 */
export async function handleGetKrsInfo(
  input: GetKrsInfoParams,
  { client, budget, profiles }: GetKrsInfoDeps,
): Promise<GetKrsInfoSuccess | GetKrsInfoError> {
  const krsNum = Number(String(input.krs).replace(/^0+/, "") || "0");
  const krsApi = toApiKrs(krsNum);
  const krsPadded = toCanonicalKrs(krsNum);
  const { orgId, userId } = parseCustomerId(input.customer_id);

  try {
    // Worst-case budget check: all three sections cold. If even this
    // doesn't fit, fail fast rather than partially draining budget.
    const worstCase =
      ENDPOINTS["02"].costPln +
      ENDPOINTS["03"].costPln +
      ENDPOINTS["06"].costPln;
    await budget.assertAllowed(orgId, worstCase);

    const existing = await profiles.getFreshByKrs(
      krsNum,
      Number.POSITIVE_INFINITY, // return the row even if stale — we decide per-section
    );

    const now = new Date();
    const ctx = { orgId, userId, krs: krsNum };

    // ---- basic (endpoint 02) ----
    let basicRaw: unknown;
    let basicSource: "cache" | "upstream";
    if (existing && isFresh(existing.basicFetchedAt, CACHE_TTL_MS.krsInfo, now)) {
      basicRaw = existing.basicRaw;
      basicSource = "cache";
    } else {
      basicRaw = await client.get("02", `/org/${krsApi}`, undefined, ctx);
      basicSource = "upstream";
    }
    const basicParsed = basicResponseSchema.safeParse(basicRaw);
    if (!basicParsed.success) {
      logger.error(
        { krs: krsNum, issues: basicParsed.error.issues.slice(0, 5) },
        "get_krs_info: endpoint 02 response failed schema validation",
      );
      return {
        success: false,
        error: "Unexpected basic-data response shape from Rejestr.io",
      };
    }
    if (basicSource === "upstream") {
      await profiles.upsertBasic(
        krsNum,
        basicPayloadFromResponse(basicParsed.data, basicRaw),
        now,
      );
    }

    // ---- advanced (endpoint 03, chapter 'ogolny') ----
    let advancedRaw: unknown;
    let advancedSource: "cache" | "upstream";
    if (existing && isFresh(existing.advancedFetchedAt, CACHE_TTL_MS.krsInfo, now)) {
      advancedRaw = existing.advancedRaw;
      advancedSource = "cache";
    } else {
      advancedRaw = await client.get(
        "03",
        `/org/${krsApi}/krs-rozdzialy/ogolny`,
        undefined,
        ctx,
      );
      advancedSource = "upstream";
    }
    const advancedParsed = advancedResponseSchema.safeParse(advancedRaw);
    if (!advancedParsed.success) {
      logger.error(
        { krs: krsNum, issues: advancedParsed.error.issues.slice(0, 5) },
        "get_krs_info: endpoint 03 response failed schema validation",
      );
      return {
        success: false,
        error: "Unexpected advanced-data response shape from Rejestr.io",
      };
    }
    if (advancedSource === "upstream") {
      await profiles.upsertAdvanced(krsNum, advancedRaw, now);
    }

    // ---- powiązania (endpoint 06) ----
    let powiazaniaRaw: unknown;
    let powiazaniaSource: "cache" | "upstream";
    if (
      existing &&
      isFresh(existing.powiazaniaFetchedAt, CACHE_TTL_MS.krsInfo, now)
    ) {
      powiazaniaRaw = existing.powiazaniaRaw;
      powiazaniaSource = "cache";
    } else {
      powiazaniaRaw = await client.get(
        "06",
        `/org/${krsApi}/krs-powiazania`,
        undefined,
        ctx,
      );
      powiazaniaSource = "upstream";
    }
    const powiazaniaParsed = powiazaniaResponseSchema.safeParse(powiazaniaRaw);
    if (!powiazaniaParsed.success) {
      logger.error(
        { krs: krsNum, issues: powiazaniaParsed.error.issues.slice(0, 5) },
        "get_krs_info: endpoint 06 response failed schema validation",
      );
      return {
        success: false,
        error: "Unexpected powiązania response shape from Rejestr.io",
      };
    }
    if (powiazaniaSource === "upstream") {
      await profiles.upsertPowiazania(krsNum, powiazaniaRaw, now);
    }

    return composeResult({
      krs: krsNum,
      krsPadded,
      basic: basicParsed.data,
      advancedEmpty: isAdvancedEmpty(advancedParsed.data),
      powiazania: powiazaniaParsed.data,
      sources: {
        basic: basicSource,
        advanced: advancedSource,
        powiazania: powiazaniaSource,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, krs: krsNum }, "get_krs_info failed");
    return { success: false, error: msg };
  }
}

function basicPayloadFromResponse(
  parsed: BasicResponse,
  raw: unknown,
) {
  return {
    id: Number(parsed.id),
    nip: parsed.numery.nip,
    regon: parsed.numery.regon,
    nazwaPelna: parsed.nazwy.pelna,
    nazwaSkrocona: parsed.nazwy.skrocona,
    formaPrawna: parsed.stan?.forma_prawna,
    pkdGlowny: parsed.stan?.pkd_przewazajace_dzial,
    raw,
  };
}

function composeResult(args: {
  krs: number;
  krsPadded: string;
  basic: BasicResponse;
  advancedEmpty: boolean;
  powiazania: z.infer<typeof powiazaniaResponseSchema>;
  sources: GetKrsInfoSuccess["sources"];
}): GetKrsInfoSuccess {
  // `ostatnie_sprawozdanie` is a Biznes-plan-or-higher field on
  // endpoint 02. When present, .glowne_pola carries the headline
  // financial figures — we lift those directly so `get_financials`
  // and callers that only want the latest year can skip the expensive
  // endpoint 11 entirely.
  type SprawozdanieShape = {
    rocznik?: number;
    data_od?: string;
    data_do?: string;
    glowne_pola?: {
      przychody?: { wartosc?: number };
      koszty?: { wartosc?: number };
      zysk?: { wartosc?: number };
      aktywa?: { wartosc?: number };
      pasywa?: { wartosc?: number };
      podatek_dochodowy?: { wartosc?: number };
    };
  };
  const spr = (args.basic as unknown as { ostatnie_sprawozdanie?: SprawozdanieShape })
    .ostatnie_sprawozdanie;
  const ostatnieSprawozdanie: GlowneSprawozdanie | null = spr
    ? {
        rocznik: spr.rocznik,
        dataOd: spr.data_od,
        dataDo: spr.data_do,
        przychody: spr.glowne_pola?.przychody?.wartosc,
        koszty: spr.glowne_pola?.koszty?.wartosc,
        zysk: spr.glowne_pola?.zysk?.wartosc,
        aktywa: spr.glowne_pola?.aktywa?.wartosc,
        pasywa: spr.glowne_pola?.pasywa?.wartosc,
        podatek: spr.glowne_pola?.podatek_dochodowy?.wartosc,
      }
    : null;

  const powiazania: Powiazanie[] = args.powiazania.map((p) => {
    const tozsamosc = (p.tozsamosc ?? {}) as {
      imiona_i_nazwisko?: string;
      nazwa?: string;
    };
    const links = p.krs_powiazania_kwerendowane ?? [];
    return {
      id: p.id as number | string,
      typ: p.typ,
      imionaI_nazwisko: tozsamosc.imiona_i_nazwisko,
      nazwa: tozsamosc.nazwa,
      kierunek: links[0]?.kierunek,
      aktywne: links.some((l) => !l.data_koniec),
    };
  });

  return {
    success: true,
    krs: args.krs,
    krsPadded: args.krsPadded,
    nip: args.basic.numery.nip != null ? String(args.basic.numery.nip) : null,
    regon:
      args.basic.numery.regon != null ? String(args.basic.numery.regon) : null,
    nazwaPelna: args.basic.nazwy.pelna,
    nazwaSkrocona: args.basic.nazwy.skrocona ?? null,
    formaPrawna: args.basic.stan?.forma_prawna ?? null,
    pkdGlowny: args.basic.stan?.pkd_przewazajace_dzial ?? null,
    siedziba: {
      miejscowosc: args.basic.adres?.miejscowosc ?? null,
      kod: args.basic.adres?.kod ?? null,
    },
    stan: {
      wykreslona: args.basic.stan?.czy_wykreslona ?? false,
      wUpadlosci: args.basic.stan?.w_upadlosci ?? false,
      wLikwidacji: args.basic.stan?.w_likwidacji ?? false,
      wZawieszeniu: args.basic.stan?.w_zawieszeniu ?? false,
      naGpw:
        (args.basic.stan as unknown as { czy_jest_na_gpw?: boolean })
          ?.czy_jest_na_gpw ?? false,
    },
    ostatnieSprawozdanie,
    advancedEmpty: args.advancedEmpty,
    powiazania,
    sources: args.sources,
  };
}

export function registerGetKrsInfo(
  mcp: FastMCP,
  deps: GetKrsInfoDeps,
): void {
  mcp.addTool({
    name: "get_krs_info",
    description:
      "Fetch the full KRS snapshot for a Polish company by its KRS id: " +
      "legal form, address, PKD, state flags (upadłość/likwidacja/zawieszenie/wykreślenie), " +
      "last-year financial snapshot if available, and current related persons/entities. " +
      "Composed from 3 Rejestr.io endpoints; cached per-section with a 30-day TTL. " +
      "Cost: up to 0.15 PLN when fully cold, 0 PLN when fully cached. " +
      "If you only have a NIP, call `lookup_company` first to get the KRS.",
    parameters: paramsSchema,
    execute: async (input) =>
      JSON.stringify(await handleGetKrsInfo(input, deps)),
  });
}
