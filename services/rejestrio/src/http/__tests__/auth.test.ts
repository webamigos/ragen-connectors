import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { enrichAuthMiddleware, signEnrichRequest } from "../auth.js";

const SECRET = "a".repeat(40);

function buildApp() {
  const app = new Hono();
  app.use("*", enrichAuthMiddleware(SECRET));
  app.post("/echo", (c) => c.json({ ok: true }));
  return app;
}

function signedHeaders(method: string, path: string, body: string) {
  const ts = String(Date.now());
  const sig = signEnrichRequest(SECRET, { timestamp: ts, method, path, body });
  return { "x-timestamp": ts, "x-signature": sig, "content-type": "application/json" };
}

describe("enrichAuthMiddleware", () => {
  it("accepts a correctly signed request", async () => {
    const body = JSON.stringify({ hello: "world" });
    const res = await buildApp().request("/echo", {
      method: "POST",
      headers: signedHeaders("POST", "/echo", body),
      body,
    });
    expect(res.status).toBe(200);
  });

  it("rejects when timestamp header is missing", async () => {
    const body = "{}";
    const ts = String(Date.now());
    const sig = signEnrichRequest(SECRET, { timestamp: ts, method: "POST", path: "/echo", body });
    const res = await buildApp().request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sig },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a non-numeric timestamp", async () => {
    const body = "{}";
    const ts = "not-a-number";
    const sig = signEnrichRequest(SECRET, { timestamp: ts, method: "POST", path: "/echo", body });
    const res = await buildApp().request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-timestamp": ts, "x-signature": sig },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects when signature header is missing", async () => {
    const res = await buildApp().request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-timestamp": String(Date.now()) },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp", async () => {
    const body = "{}";
    const staleTs = String(Date.now() - 10 * 60 * 1000);
    const sig = signEnrichRequest(SECRET, {
      timestamp: staleTs,
      method: "POST",
      path: "/echo",
      body,
    });
    const res = await buildApp().request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json", "x-timestamp": staleTs, "x-signature": sig },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("rejects a tampered body", async () => {
    const body = JSON.stringify({ hello: "world" });
    const headers = signedHeaders("POST", "/echo", body);
    const res = await buildApp().request("/echo", {
      method: "POST",
      headers,
      body: JSON.stringify({ hello: "tampered" }),
    });
    expect(res.status).toBe(401);
  });
});
