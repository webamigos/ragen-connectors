import { describe, expect, it, vi } from "vitest";
import { handleEnrichCompany } from "../enrich.js";
import type { EnrichDeps } from "../enrich.js";
import * as lookupTool from "../../tools/lookup-company.js";
import * as krsInfoTool from "../../tools/get-krs-info.js";
import * as financialsTool from "../../tools/get-financials.js";

function fakeDeps(): EnrichDeps {
  return {} as unknown as EnrichDeps;
}

describe("handleEnrichCompany", () => {
  it("returns flattened payload when called with a KRS directly", async () => {
    vi.spyOn(krsInfoTool, "handleGetKrsInfo").mockResolvedValue({
      success: true,
      krs: 10681,
      krsPadded: "0000010681",
      nip: "1132916831",
      regon: "012345678",
      nazwaPelna: "Acme Sp. z o.o.",
      nazwaSkrocona: "Acme",
      formaPrawna: "Spółka z o.o.",
      pkdGlowny: "62.01.Z",
      siedziba: { miejscowosc: "Warszawa", kod: "00-001" },
      stan: {
        wykreslona: false,
        wUpadlosci: false,
        wLikwidacji: false,
        wZawieszeniu: false,
        naGpw: false,
        wielkosc: null,
      },
      ostatnieSprawozdanie: {
        rocznik: 2023,
        przychody: 1_500_000,
        zysk: 200_000,
        aktywa: 800_000,
      },
      kapitalZakladowy: null,
      wspolnicy: [],
      advancedEmpty: false,
      powiazania: [],
      sources: { basic: "cache", advanced: "cache", powiazania: "cache" },
    });

    const result = await handleEnrichCompany(
      { customerId: "org-1:user-1", krs: 10681, includeFinancials: false },
      fakeDeps(),
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.matched).toEqual({ source: "krs", via: undefined });
    expect(result.data.krs).toBe("0000010681");
    expect(result.data.nip).toBe("1132916831");
    expect(result.data.przychodyPln).toBe(1_500_000);
    expect(result.data.sprawozdanieRocznik).toBe(2023);
    expect(result.data.miejscowosc).toBe("Warszawa");
  });

  it("looks up by name when no KRS provided and picks top hit", async () => {
    vi.spyOn(lookupTool, "handleLookupCompany").mockResolvedValue({
      success: true,
      totalFound: 1,
      results: [
        {
          krs: 10681,
          krsPadded: "0000010681",
          nip: "1132916831",
          regon: null,
          nazwaPelna: "Acme Sp. z o.o.",
          nazwaSkrocona: null,
          formaPrawna: null,
          pkdGlowny: null,
          siedziba: { miejscowosc: "Warszawa", kod: null },
          wykreslona: false,
          wUpadlosci: false,
          wLikwidacji: false,
        },
      ],
    });
    vi.spyOn(krsInfoTool, "handleGetKrsInfo").mockResolvedValue({
      success: true,
      krs: 10681,
      krsPadded: "0000010681",
      nip: "1132916831",
      regon: null,
      nazwaPelna: "Acme Sp. z o.o.",
      nazwaSkrocona: null,
      formaPrawna: "Spółka z o.o.",
      pkdGlowny: "62.01.Z",
      siedziba: { miejscowosc: "Warszawa", kod: null },
      stan: {
        wykreslona: false,
        wUpadlosci: false,
        wLikwidacji: false,
        wZawieszeniu: false,
        naGpw: false,
        wielkosc: null,
      },
      ostatnieSprawozdanie: null,
      kapitalZakladowy: null,
      wspolnicy: [],
      advancedEmpty: false,
      powiazania: [],
      sources: { basic: "upstream", advanced: "upstream", powiazania: "upstream" },
    });

    const result = await handleEnrichCompany(
      { customerId: "org-1:user-1", name: "Acme", includeFinancials: false },
      fakeDeps(),
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.matched.source).toBe("name");
    expect(result.matched.via).toBe("lookup:0000010681");
    expect(result.data.przychodyPln).toBeNull();
  });

  it("returns not_found when lookup yields zero results", async () => {
    vi.spyOn(lookupTool, "handleLookupCompany").mockResolvedValue({
      success: true,
      totalFound: 0,
      results: [],
    });

    const result = await handleEnrichCompany(
      { customerId: "org-1:user-1", name: "Nonexistent Co", includeFinancials: false },
      fakeDeps(),
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.code).toBe("not_found");
  });

  it("falls back to financials endpoint when basic data has no tier-1 snapshot", async () => {
    vi.spyOn(krsInfoTool, "handleGetKrsInfo").mockResolvedValue({
      success: true,
      krs: 10681,
      krsPadded: "0000010681",
      nip: null,
      regon: null,
      nazwaPelna: "Acme",
      nazwaSkrocona: null,
      formaPrawna: null,
      pkdGlowny: null,
      siedziba: { miejscowosc: null, kod: null },
      stan: {
        wykreslona: false,
        wUpadlosci: false,
        wLikwidacji: false,
        wZawieszeniu: false,
        naGpw: false,
        wielkosc: null,
      },
      ostatnieSprawozdanie: null,
      kapitalZakladowy: null,
      wspolnicy: [],
      advancedEmpty: false,
      powiazania: [],
      sources: { basic: "cache", advanced: "cache", powiazania: "cache" },
    });
    const finSpy = vi
      .spyOn(financialsTool, "handleGetFinancials")
      .mockResolvedValue({
        success: true,
        krs: 10681,
        krsPadded: "0000010681",
        tierUsed: "tier_2",
        statements: [
          {
            rocznik: 2022,
            przychody: 999,
            zysk: 100,
            aktywa: 500,
            koszty: null,
            pasywa: null,
            podatek: null,
            dataOd: null,
            dataDo: null,
          },
        ],
      } as unknown as Awaited<ReturnType<typeof financialsTool.handleGetFinancials>>);

    const result = await handleEnrichCompany(
      { customerId: "org-1:user-1", krs: 10681, includeFinancials: true },
      fakeDeps(),
    );

    expect(finSpy).toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.przychodyPln).toBe(999);
    expect(result.data.sprawozdanieRocznik).toBe(2022);
  });
});
