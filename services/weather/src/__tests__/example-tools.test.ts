/**
 * What a connector's tests have to cover, and why these two cases rather than
 * a happy path.
 *
 * The `{success: false}` branch is the one that actually ships to the model:
 * an upstream is down or rate-limited far more often than a tool's arguments
 * are wrong, and a `catch` that itself throws turns every upstream failure
 * into an opaque protocol error. Test it first.
 *
 * `fetch` is stubbed. Never let a test reach a live API — it makes the suite
 * fail for reasons that have nothing to do with the change, and on a paid
 * upstream it spends money.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { FastMCP } from "fastmcp";
import { registerWeatherTools } from "../tools/example-tools.js";
import { testContext } from "./session.js";

type ToolShape = {
  name: string;
  execute: (args: Record<string, unknown>, context: unknown) => Promise<string>;
};

/** The tools a registration adds, without starting a listener. */
function registeredTools(): Map<string, ToolShape> {
  const tools = new Map<string, ToolShape>();
  const mcp = {
    addTool: (tool: ToolShape) => tools.set(tool.name, tool),
  } as unknown as FastMCP;
  registerWeatherTools(mcp as never);
  return tools;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("find_place", () => {
  it("returns an envelope carrying the places", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              name: "Warsaw",
              country: "Poland",
              latitude: 52.23,
              longitude: 21.01,
              timezone: "Europe/Warsaw",
            },
          ],
        }),
      }),
    );

    const tool = registeredTools().get("find_place");
    const result = JSON.parse(
      await tool!.execute({ customer_id: "org:user:weather", name: "Warsaw" }, testContext()),
    );

    expect(result.success).toBe(true);
    expect(result.places[0].name).toBe("Warsaw");
    expect(result.count).toBe(1);
  });

  it("reports an upstream failure as an envelope, never a throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
      }),
    );

    const tool = registeredTools().get("find_place");
    const raw = await tool!.execute(
      { customer_id: "org:user:weather", name: "Warsaw" },
      testContext(),
    );
    const result = JSON.parse(raw);

    expect(result.success).toBe(false);
    // The status reaches the model: a 401 means the customer's credential and
    // a 429 means back off, and neither is visible in "request failed".
    expect(result.error).toContain("503");
  });
});

describe("get_current_weather", () => {
  it("forwards the coordinates and returns the reading", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        current: { temperature_2m: 3.4, wind_speed_10m: 11, time: "2026-01-01T12:00" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = registeredTools().get("get_current_weather");
    const result = JSON.parse(
      await tool!.execute(
        { customer_id: "org:user:weather", latitude: 52.23, longitude: 21.01 },
        testContext(),
      ),
    );

    expect(result.success).toBe(true);
    expect(result.weather.temperatureC).toBe(3.4);

    // The arguments actually reached the upstream. A tool that answers
    // plausibly for the wrong place is worse than one that fails.
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("latitude=52.23");
    expect(url).toContain("longitude=21.01");
  });

  it("resolves with an envelope when the upstream fails, rather than rejecting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({}),
      }),
    );

    const tool = registeredTools().get("get_current_weather");
    const raw = await tool!.execute(
      { customer_id: "org:user:weather", latitude: 52.23, longitude: 21.01 },
      testContext(),
    );

    // `resolves`, not `rejects` — a throw reaches the model as an opaque
    // protocol error it cannot act on.
    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toContain("429");
  });
});

describe("the wire contract", () => {
  it("takes customer_id as a parameter, so a call with no headers still works", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      }),
    );

    // Ragen sends `x-customer-id` only for a `server_side` connector; on every
    // other auth shape the parameter is the only channel. A tool that read the
    // header would work in development and serve the wrong customer in
    // production.
    const tool = registeredTools().get("find_place");
    const result = JSON.parse(
      await tool!.execute({ customer_id: "org:user:weather", name: "Nowhere" }, testContext()),
    );

    expect(result.success).toBe(true);
  });
});
