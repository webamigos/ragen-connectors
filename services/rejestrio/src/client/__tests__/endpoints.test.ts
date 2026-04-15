import { describe, expect, it } from "vitest";
import {
  ENDPOINTS,
  tierSatisfies,
  toApiKrs,
  toCanonicalKrs,
} from "../endpoints.js";

describe("toApiKrs", () => {
  it("strips leading zeros from zero-padded form", () => {
    expect(toApiKrs("0000010681")).toBe("10681");
  });

  it("passes integer form through unchanged", () => {
    expect(toApiKrs("10681")).toBe("10681");
    expect(toApiKrs(10681)).toBe("10681");
  });

  it("never returns empty string — all-zero input folds to '0'", () => {
    expect(toApiKrs("0000000000")).toBe("0");
  });

  it("throws on non-numeric input", () => {
    expect(() => toApiKrs("abc")).toThrow(/Invalid KRS/);
    expect(() => toApiKrs("123 456")).toThrow(/Invalid KRS/);
  });

  it("throws on too-long input", () => {
    expect(() => toApiKrs("12345678901")).toThrow(/Invalid KRS/);
  });
});

describe("toCanonicalKrs", () => {
  it("zero-pads to 10 digits", () => {
    expect(toCanonicalKrs(10681)).toBe("0000010681");
    expect(toCanonicalKrs("10681")).toBe("0000010681");
  });

  it("round-trips against toApiKrs", () => {
    const canonical = "0000634215";
    expect(toCanonicalKrs(toApiKrs(canonical))).toBe(canonical);
  });
});

describe("tierSatisfies", () => {
  it("respects the tier hierarchy base < premium < biznes", () => {
    expect(tierSatisfies("base", "base")).toBe(true);
    expect(tierSatisfies("premium", "base")).toBe(true);
    expect(tierSatisfies("biznes", "premium")).toBe(true);
    expect(tierSatisfies("base", "premium")).toBe(false);
    expect(tierSatisfies("premium", "biznes")).toBe(false);
  });
});

describe("ENDPOINTS cost table", () => {
  it("keeps endpoint 11 priced 10× the others", () => {
    // Sanity check against the pricing we rely on for budget math.
    expect(ENDPOINTS["11"].costPln).toBe(0.5);
    for (const id of ["01", "02", "03", "06", "10"] as const) {
      expect(ENDPOINTS[id].costPln).toBe(0.05);
    }
  });
});
