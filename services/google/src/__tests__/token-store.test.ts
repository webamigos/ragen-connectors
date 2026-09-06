import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockStoreToken, mockGetToken, mockDeleteToken } = vi.hoisted(() => ({
  mockStoreToken: vi.fn(),
  mockGetToken: vi.fn(),
  mockDeleteToken: vi.fn(),
}));

vi.mock("@ragen-connectors/core", () => ({
  RagenVaultClient: vi.fn(),
  ragenVaultClient: {
    storeToken: mockStoreToken,
    getToken: mockGetToken,
    deleteToken: mockDeleteToken,
  },
}));

import { saveTokens, getAccessToken, deleteTokens } from "../auth/token-store.js";

describe("google token-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("saveTokens", () => {
    it("stores tokens via vault client", async () => {
      mockStoreToken.mockResolvedValue({});

      await saveTokens("cust1", "access-tok", "refresh-tok");

      expect(mockStoreToken).toHaveBeenCalledWith("cust1", "GOOGLE", {
        access_token: "access-tok",
        refresh_token: "refresh-tok",
        client_id: expect.any(String),
      });
    });
  });

  describe("getAccessToken", () => {
    it("returns access token from vault", async () => {
      mockGetToken.mockResolvedValue({ access_token: "my-token" });

      const token = await getAccessToken("cust1");
      expect(token).toBe("my-token");
      expect(mockGetToken).toHaveBeenCalledWith("cust1", "GOOGLE");
    });

    it("throws with auth URL when vault has no tokens", async () => {
      mockGetToken.mockRejectedValue(new Error("not found"));

      await expect(getAccessToken("cust1")).rejects.toThrow(
        "No tokens found for customer 'cust1'",
      );
    });

    it("throws when access_token is not a string", async () => {
      mockGetToken.mockResolvedValue({ access_token: 123 });

      await expect(getAccessToken("cust1")).rejects.toThrow(
        "Invalid token data for customer 'cust1'",
      );
    });

    it("throws when access_token is empty string", async () => {
      mockGetToken.mockResolvedValue({ access_token: "" });

      await expect(getAccessToken("cust1")).rejects.toThrow(
        "Invalid token data for customer 'cust1'",
      );
    });
  });

  describe("deleteTokens", () => {
    it("deletes via vault client", async () => {
      mockDeleteToken.mockResolvedValue(undefined);

      await deleteTokens("cust1");
      expect(mockDeleteToken).toHaveBeenCalledWith("cust1", "GOOGLE");
    });
  });
});
