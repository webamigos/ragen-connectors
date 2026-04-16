import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractPkdCodeFromAdvanced } from "../company-profile-repo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../../probe/fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

describe("extractPkdCodeFromAdvanced", () => {
  it("joins the symbol tuple ['62','01','Z'] into '62.01.Z'", () => {
    const synthetic = {
      przedmiot_przewazajacej_dzialalnosci_przedsiebiorcy: {
        _obiekty: {
          "1": {
            _wartosc: {
              symbol: ["62", "01", "Z"],
              opis: "Działalność związana z oprogramowaniem",
              scheme: "pkd2007",
            },
          },
        },
      },
    };
    expect(extractPkdCodeFromAdvanced(synthetic)).toBe("62.01.Z");
  });

  it("extracts the real code from the captured small-spzoo fixture", () => {
    const advanced = loadFixture("03-krs-0000634215-ogolny.json");
    // Fixture has przewazajacy PKD 69.20.Z (rachunkowosc/doradztwo).
    expect(extractPkdCodeFromAdvanced(advanced)).toBe("69.20.Z");
  });

  it("returns null for wykreślone entries (endpoint 03 returns [])", () => {
    const advanced = loadFixture("03-krs-0000458061-ogolny.json");
    expect(extractPkdCodeFromAdvanced(advanced)).toBeNull();
  });

  it("handles missing / malformed input defensively", () => {
    expect(extractPkdCodeFromAdvanced(null)).toBeNull();
    expect(extractPkdCodeFromAdvanced(undefined)).toBeNull();
    expect(extractPkdCodeFromAdvanced("string")).toBeNull();
    expect(extractPkdCodeFromAdvanced({})).toBeNull();
    expect(
      extractPkdCodeFromAdvanced({
        przedmiot_przewazajacej_dzialalnosci_przedsiebiorcy: {
          _obiekty: {},
        },
      }),
    ).toBeNull();
  });

  it("skips non-string elements in the symbol array", () => {
    const synthetic = {
      przedmiot_przewazajacej_dzialalnosci_przedsiebiorcy: {
        _obiekty: {
          "1": {
            _wartosc: { symbol: ["62", 1, "Z"] }, // integer slips in
          },
        },
      },
    };
    // Non-strings are filtered out; result uses what's left.
    expect(extractPkdCodeFromAdvanced(synthetic)).toBe("62.Z");
  });
});
