import { describe, it, expect, vi, afterEach } from "vitest";
import { saveState, popState } from "../state-store.js";

describe("state-store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves and retrieves state", () => {
    saveState("state-1", "customer-1", "http://redirect.example");
    const result = popState("state-1");

    expect(result).toEqual({
      customerId: "customer-1",
      redirectUri: "http://redirect.example",
      createdAt: expect.any(Number),
    });
  });

  it("returns undefined for unknown state", () => {
    expect(popState("nonexistent")).toBeUndefined();
  });

  it("removes state after pop (single-use)", () => {
    saveState("state-2", "customer-2");
    popState("state-2");
    expect(popState("state-2")).toBeUndefined();
  });

  it("defaults redirectUri to empty string", () => {
    saveState("state-3", "customer-3");
    const result = popState("state-3");
    expect(result?.redirectUri).toBe("");
  });

  it("cleans up expired entries on save", () => {
    // Save a state at time T
    const baseTime = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(baseTime);
    saveState("old-state", "old-customer");

    // Advance past TTL (10 minutes + 1ms)
    vi.spyOn(Date, "now").mockReturnValue(baseTime + 10 * 60 * 1000 + 1);
    saveState("new-state", "new-customer");

    // Old state should be cleaned up
    expect(popState("old-state")).toBeUndefined();
    expect(popState("new-state")).toBeDefined();
  });

  it("cleans up expired entries on pop", () => {
    const baseTime = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(baseTime);
    saveState("expiring-state", "customer");

    // Advance past TTL
    vi.spyOn(Date, "now").mockReturnValue(baseTime + 10 * 60 * 1000 + 1);
    expect(popState("expiring-state")).toBeUndefined();
  });
});
