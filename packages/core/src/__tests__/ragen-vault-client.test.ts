import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RagenVaultClient } from "../ragen-vault-client.js";

const BASE_URL = "https://vault.example.com";
const SECRET = "test-secret-key";

function createClient() {
  return new RagenVaultClient(BASE_URL, SECRET);
}

describe("RagenVaultClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("strips trailing slash from baseUrl", async () => {
      const client = new RagenVaultClient("https://vault.example.com/", SECRET);
      // Verify by making a request and checking the URL
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal("fetch", mockFetch);

      await client.getToken("cust1", "GOOGLE");
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).not.toContain("//v1");
    });

    it("throws if baseUrl is empty", () => {
      expect(() => new RagenVaultClient("", SECRET)).toThrow(
        "RAGEN_TOKEN_VAULT_URL environment variable is required",
      );
    });

    it("throws if secret is empty", () => {
      expect(() => new RagenVaultClient(BASE_URL, "")).toThrow(
        "RAGEN_TOKEN_VAULT_SERVICE_SECRET environment variable is required",
      );
    });
  });

  describe("sign (via request headers)", () => {
    it("produces HMAC-SHA256 Authorization header", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "tok" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      await client.getToken("cust1", "GOOGLE");

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^HMAC-SHA256 ts=\d+,sig=[a-f0-9]{64}$/);
      expect(headers["X-Service-Name"]).toBeTruthy();
    });
  });

  describe("storeToken", () => {
    it("sends PUT with JSON body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ stored: true }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      const result = await client.storeToken("cust1", "GOOGLE", {
        access_token: "at",
        refresh_token: "rt",
      });

      expect(result).toEqual({ stored: true });
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/tokens/cust1/GOOGLE`);
      expect(opts.method).toBe("PUT");
      expect(JSON.parse(opts.body)).toEqual({
        access_token: "at",
        refresh_token: "rt",
      });
    });
  });

  describe("getToken", () => {
    it("sends GET request to correct path", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "at123" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      const result = await client.getToken("cust1", "HUBSPOT");

      expect(result).toEqual({ access_token: "at123" });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/tokens/cust1/HUBSPOT`);
      expect(opts.method).toBe("GET");
    });

    it("encodes special characters in customerId", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      await client.getToken("cust/special", "GOOGLE");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("cust%2Fspecial");
    });
  });

  describe("deleteToken", () => {
    it("sends DELETE request", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      await client.deleteToken("cust1", "GOOGLE");

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/tokens/cust1/GOOGLE`);
      expect(opts.method).toBe("DELETE");
    });
  });

  describe("getTokenStatus", () => {
    it("appends /status to path", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "active" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      const result = await client.getTokenStatus("cust1", "GOOGLE");

      expect(result).toEqual({ status: "active" });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe(`${BASE_URL}/v1/tokens/cust1/GOOGLE/status`);
    });
  });

  describe("listTokens", () => {
    it("lists tokens for a customer", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tokens: ["GOOGLE", "HUBSPOT"] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      const result = await client.listTokens("cust1");

      expect(result).toEqual({ tokens: ["GOOGLE", "HUBSPOT"] });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe(`${BASE_URL}/v1/tokens/cust1`);
    });
  });

  describe("getGoogleAuthUrl", () => {
    it("returns location header from redirect response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Headers({ location: "https://accounts.google.com/auth?foo=bar" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      const url = await client.getGoogleAuthUrl("cust1", "calendar", "http://localhost/cb");

      expect(url).toBe("https://accounts.google.com/auth?foo=bar");
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.redirect).toBe("manual");
    });

    it("throws if no location header", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 302,
        headers: new Headers(),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      await expect(
        client.getGoogleAuthUrl("cust1", "calendar", "http://localhost/cb"),
      ).rejects.toThrow("did not return a redirect Location header");
    });
  });

  describe("refreshGoogleToken", () => {
    it("sends POST with customer_id and provider", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "new-at" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      const result = await client.refreshGoogleToken("cust1");

      expect(result).toEqual({ access_token: "new-at" });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/oauth/google/refresh`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        customer_id: "cust1",
        provider: "GOOGLE",
      });
    });
  });

  describe("error handling", () => {
    it("throws on non-ok response (not redirect)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const client = createClient();
      await expect(client.getToken("cust1", "GOOGLE")).rejects.toThrow(
        "ragen-token-vault GET /v1/tokens/cust1/GOOGLE failed (500): Internal Server Error",
      );
    });
  });
});
