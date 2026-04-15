import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractWspolnicy } from "../get-krs-info.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../../probe/fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

describe("extractWspolnicy", () => {
  it("parses a 2-wspólnik sp. z o.o. and calculates percentages (small-spzoo fixture)", () => {
    const advanced = loadFixture("03-krs-0000634215-ogolny.json");
    const { kapitalZakladowy, wspolnicy } = extractWspolnicy(advanced);

    expect(kapitalZakladowy).toEqual({ kwota: 5000, waluta: "ZŁ" });
    expect(wspolnicy).toHaveLength(2);

    // 51 + 49 = 100 udziałów, 51 % / 49 %.
    expect(wspolnicy[0]).toMatchObject({
      typ: "person",
      liczbaUdzialow: 51,
      wartoscUdzialowPln: 2550,
      cenaUdzialuPln: 50,
      procentUdzialow: 51,
      posiadaCaloscAkcji: false,
    });
    expect(wspolnicy[0].nazwa).toContain("Piasecki");
    expect(wspolnicy[1].procentUdzialow).toBe(49);
  });

  it("returns empty for wykreślone entries (03 returns []`)", () => {
    const advanced = loadFixture("03-krs-0000458061-ogolny.json");
    const { kapitalZakladowy, wspolnicy } = extractWspolnicy(advanced);
    expect(kapitalZakladowy).toBeNull();
    expect(wspolnicy).toEqual([]);
  });

  it("survives null / malformed input", () => {
    expect(extractWspolnicy(null).wspolnicy).toEqual([]);
    expect(extractWspolnicy(undefined).wspolnicy).toEqual([]);
    expect(extractWspolnicy("a string").wspolnicy).toEqual([]);
    expect(extractWspolnicy(42).wspolnicy).toEqual([]);
  });

  it("calculates percentages correctly when a wspólnik owns 100%", () => {
    const synthetic = {
      wysokosc_kapitalu_zakladowego: {
        _wartosc: { kwota: 10000, waluta: "ZŁ" },
      },
      dane_wspolnikow: {
        _obiekty: {
          "1": {
            person: { _wartosc: { nazwa: "Solo Owner" } },
            posiadane_przez_wspolnika_udzialy__liczba: { _wartosc: 100 },
            posiadane_przez_wspolnika_udzialy__wartosc: {
              _wartosc: { kwota: 10000 },
            },
            posiadane_przez_wspolnika_udzialy__cena_udzialu: {
              _wartosc: { kwota: 100 },
            },
            czy_wspolnik_posiada_calosc_akcji_spolki: { _wartosc: "TAK" },
          },
        },
      },
    };
    const { wspolnicy } = extractWspolnicy(synthetic);
    expect(wspolnicy).toHaveLength(1);
    expect(wspolnicy[0].procentUdzialow).toBe(100);
    expect(wspolnicy[0].posiadaCaloscAkcji).toBe(true);
  });

  it("returns null percentages when any liczbaUdzialow is unparseable", () => {
    const synthetic = {
      dane_wspolnikow: {
        _obiekty: {
          "1": {
            person: { _wartosc: { nazwa: "A" } },
            posiadane_przez_wspolnika_udzialy__liczba: { _wartosc: 51 },
          },
          "2": {
            person: { _wartosc: { nazwa: "B" } },
            // Missing liczba — can't sum → all percentages null.
          },
        },
      },
    };
    const { wspolnicy } = extractWspolnicy(synthetic);
    expect(wspolnicy.every((w) => w.procentUdzialow === null)).toBe(true);
  });
});
