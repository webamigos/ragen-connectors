import { describe, it, expect } from "vitest";
import { getCustomerId } from "../customer.js";

describe("getCustomerId", () => {
  it("extracts x-customer-id from headers", () => {
    expect(getCustomerId({ "x-customer-id": "cust-123" })).toBe("cust-123");
  });

  it("throws when x-customer-id is missing", () => {
    expect(() => getCustomerId({})).toThrow("Missing x-customer-id header");
  });

  it("throws when x-customer-id is undefined", () => {
    expect(() => getCustomerId({ "x-customer-id": undefined })).toThrow(
      "Missing x-customer-id header",
    );
  });
});
