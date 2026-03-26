import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock token-store before importing google-api
vi.mock("../auth/token-store.js", () => ({
  getAccessToken: vi.fn(),
  refreshAndGetToken: vi.fn(),
}));

import { googleGet, googlePost, googleGetText } from "../services/google-api.js";
import { getAccessToken, refreshAndGetToken } from "../auth/token-store.js";

const mockGetAccessToken = vi.mocked(getAccessToken);
const mockRefreshAndGetToken = vi.mocked(refreshAndGetToken);

describe("google-api", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockGetAccessToken.mockResolvedValue("access-token-1");
    mockRefreshAndGetToken.mockResolvedValue("refreshed-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("googleGet", () => {
    it("makes GET request with auth header", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: "test" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await googleGet("cust1", "https://www.googleapis.com/calendar/v3/events");

      expect(result).toEqual({ data: "test" });
      expect(mockFetch).toHaveBeenCalledOnce();
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer access-token-1");
    });

    it("appends query params", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
      vi.stubGlobal("fetch", mockFetch);

      await googleGet("cust1", "https://api.example.com/data", { key: "value" });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe("https://api.example.com/data?key=value");
    });

    it("retries with refreshed token on 401", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ refreshed: true }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const result = await googleGet("cust1", "https://api.example.com/data");

      expect(result).toEqual({ refreshed: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockRefreshAndGetToken).toHaveBeenCalledWith("cust1");
      const retryHeaders = mockFetch.mock.calls[1][1].headers;
      expect(retryHeaders.Authorization).toBe("Bearer refreshed-token");
    });

    it("throws on non-401 error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        googleGet("cust1", "https://api.example.com/data"),
      ).rejects.toThrow("Google API GET https://api.example.com/data failed (403): Forbidden");
    });
  });

  describe("googlePost", () => {
    it("makes POST request with JSON body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ created: true }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await googlePost("cust1", "https://api.example.com/create", {
        name: "test",
      });

      expect(result).toEqual({ created: true });
      const opts = mockFetch.mock.calls[0][1];
      expect(opts.method).toBe("POST");
      expect(opts.body).toBe(JSON.stringify({ name: "test" }));
    });

    it("throws on non-401 error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server Error"),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        googlePost("cust1", "https://api.example.com/create", { data: "test" }),
      ).rejects.toThrow("Google API POST https://api.example.com/create failed (500): Server Error");
    });

    it("retries POST on 401", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const result = await googlePost("cust1", "https://api.example.com/create");
      expect(result).toEqual({ ok: true });
      expect(mockRefreshAndGetToken).toHaveBeenCalledWith("cust1");
    });
  });

  describe("googleGetText", () => {
    it("returns text response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("file content here"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await googleGetText("cust1", "https://api.example.com/file");
      expect(result).toBe("file content here");
    });

    it("throws on non-401 error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server Error"),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        googleGetText("cust1", "https://api.example.com/file"),
      ).rejects.toThrow("Google API GET https://api.example.com/file failed (500): Server Error");
    });

    it("retries text GET on 401", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () => Promise.resolve("content after refresh"),
        });
      vi.stubGlobal("fetch", mockFetch);

      const result = await googleGetText("cust1", "https://api.example.com/file");
      expect(result).toBe("content after refresh");
    });
  });
});
