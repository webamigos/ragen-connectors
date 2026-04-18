import { describe, expect, it, vi } from "vitest";
import { RejestrioClient } from "../rejestrio-client.js";
import {
  RejestrioAuthError,
  RejestrioHttpError,
  RejestrioPlanTierError,
  RejestrioRateLimitError,
} from "../errors.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("RejestrioClient", () => {
  it("returns parsed JSON on 2xx and invokes onCallComplete once", async () => {
    const fetchStub = vi.fn(async () => jsonResponse({ hello: "world" }));
    const hook = vi.fn();
    const client = new RejestrioClient(
      {
        apiKey: "k",
        baseUrl: "https://api.test/v2",
        onCallComplete: hook,
      },
      fetchStub,
    );

    const out = await client.get("02", "/org/123");
    expect(out).toEqual({ hello: "world" });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0]).toMatchObject({
      endpoint: "02",
      httpStatus: 200,
      costPln: 0.05,
    });
  });

  it("maps 401 to RejestrioAuthError", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ info: "bad key" }, { status: 401 }),
    );
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2", maxRetries: 0 },
      fetchStub,
    );

    await expect(client.get("02", "/org/123")).rejects.toBeInstanceOf(
      RejestrioAuthError,
    );
  });

  it("maps 403 to RejestrioPlanTierError", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ info: "plan gate" }, { status: 403 }),
    );
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2", maxRetries: 0 },
      fetchStub,
    );

    await expect(client.get("10", "/org/123/krs-dokumenty")).rejects.toBeInstanceOf(
      RejestrioPlanTierError,
    );
  });

  it("does not retry 4xx (other than 429)", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ info: "bad input" }, { status: 400 }),
    );
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2" },
      fetchStub,
    );

    await expect(client.get("02", "/org/123")).rejects.toBeInstanceOf(
      RejestrioHttpError,
    );
    // Single call — no retries burned.
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("retries 429 with a short backoff, then succeeds", async () => {
    let call = 0;
    const fetchStub = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({ info: "slow down" }, {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return jsonResponse({ ok: true });
    });
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2", maxRetries: 3 },
      fetchStub,
    );

    const out = await client.get("01", "/org", { nip: "1234567890" });
    expect(out).toEqual({ ok: true });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries on persistent 429", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ info: "slow down" }, {
        status: 429,
        headers: { "retry-after": "0" },
      }),
    );
    const client = new RejestrioClient(
      { apiKey: "k", baseUrl: "https://api.test/v2", maxRetries: 1 },
      fetchStub,
    );

    await expect(client.get("02", "/org/123")).rejects.toBeInstanceOf(
      RejestrioRateLimitError,
    );
    // 1 initial + 1 retry = 2 calls total.
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("swallows errors from the onCallComplete hook", async () => {
    const fetchStub = vi.fn(async () => jsonResponse({ ok: true }));
    const client = new RejestrioClient(
      {
        apiKey: "k",
        baseUrl: "https://api.test/v2",
        onCallComplete: async () => {
          throw new Error("hook failed");
        },
      },
      fetchStub,
    );

    // Must not throw — hook failures shouldn't mask upstream success.
    const out = await client.get("02", "/org/123");
    expect(out).toEqual({ ok: true });
  });
});
