/**
 * The org fragment of `customer_id` is a spend control on this
 * service — `BudgetGuard` enforces the daily PLN ceiling per org, so
 * anything that parses to "no org" must be refused rather than billed.
 * These tests pin the two shapes that previously slipped through.
 */
import { describe, expect, it } from "vitest";
import { parseCustomerId } from "../customer-id.js";

describe("parseCustomerId", () => {
  it("splits the documented {orgId}:{userId}:{provider} shape", () => {
    expect(parseCustomerId("org-1:user-1:REJESTRIO")).toEqual({
      orgId: "org-1",
      userId: "user-1",
    });
  });

  it("accepts an org with no user or provider fragment", () => {
    expect(parseCustomerId("org-1")).toEqual({ orgId: "org-1", userId: null });
  });

  it("tolerates extra fragments beyond the first two", () => {
    expect(parseCustomerId("org-1:user-1:REJESTRIO:extra:more")).toEqual({
      orgId: "org-1",
      userId: "user-1",
    });
  });

  // Regression: an empty leading segment yielded orgId null, which the
  // budget guard then treated as "nothing to enforce" and waved through.
  it("returns a null org for a blank leading segment", () => {
    expect(parseCustomerId(":user-1:REJESTRIO").orgId).toBeNull();
    expect(parseCustomerId(":::").orgId).toBeNull();
    expect(parseCustomerId("").orgId).toBeNull();
  });

  // Regression: a whitespace-only segment is truthy, so it used to
  // become an org literally named "  " — with its own untouched daily
  // budget, and a fresh one for every variation of padding.
  it("treats a whitespace-only segment as absent, not as an org name", () => {
    expect(parseCustomerId("  :user-1:REJESTRIO").orgId).toBeNull();
    expect(parseCustomerId("\t:user-1:REJESTRIO").orgId).toBeNull();
    expect(parseCustomerId(" \n :u:R").orgId).toBeNull();
  });

  it("trims surrounding whitespace off a real org and user", () => {
    expect(parseCustomerId(" org-1 : user-1 :REJESTRIO")).toEqual({
      orgId: "org-1",
      userId: "user-1",
    });
  });

  it("returns a null user for a blank middle segment, keeping the org", () => {
    expect(parseCustomerId("org-1::REJESTRIO")).toEqual({
      orgId: "org-1",
      userId: null,
    });
  });
});
