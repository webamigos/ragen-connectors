import { describe, expect, it } from "vitest";
import { CACHE_TTL_MS, isFresh } from "../ttl.js";

const DAY = 24 * 60 * 60 * 1000;

describe("isFresh", () => {
  it("is false for null fetchedAt (never fetched)", () => {
    expect(isFresh(null, CACHE_TTL_MS.krsInfo)).toBe(false);
    expect(isFresh(undefined, CACHE_TTL_MS.krsInfo)).toBe(false);
  });

  it("is true within the TTL window", () => {
    const now = new Date("2026-04-15T12:00:00Z");
    const fetched = new Date(now.getTime() - 10 * DAY);
    expect(isFresh(fetched, CACHE_TTL_MS.krsInfo, now)).toBe(true);
  });

  it("is false past the TTL window", () => {
    const now = new Date("2026-04-15T12:00:00Z");
    const fetched = new Date(now.getTime() - 31 * DAY);
    expect(isFresh(fetched, CACHE_TTL_MS.krsInfo, now)).toBe(false);
  });
});

describe("CACHE_TTL_MS", () => {
  it("keeps financial documents the longest — they never change after filing", () => {
    expect(CACHE_TTL_MS.finDoc).toBeGreaterThan(CACHE_TTL_MS.krsInfo);
    expect(CACHE_TTL_MS.krsInfo).toBeGreaterThan(CACHE_TTL_MS.search);
  });
});
