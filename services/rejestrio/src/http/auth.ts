import { createHmac, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const MAX_SKEW_MS = 5 * 60 * 1000;

export type SignedPayload = {
  timestamp: string;
  method: string;
  path: string;
  body: string;
};

export function signEnrichRequest(secret: string, payload: SignedPayload): string {
  const message = `${payload.timestamp}.${payload.method.toUpperCase()}.${payload.path}.${payload.body}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function enrichAuthMiddleware(secret: string): MiddlewareHandler {
  return async (c, next) => {
    const signature = c.req.header("x-signature");
    const timestamp = c.req.header("x-timestamp");
    if (!signature || !timestamp) {
      return c.json({ error: "missing signature headers" }, 401);
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
      return c.json({ error: "stale or invalid timestamp" }, 401);
    }

    const method = c.req.method;
    const body = method === "GET" || method === "HEAD" ? "" : await c.req.text();
    const expected = signEnrichRequest(secret, {
      timestamp,
      method,
      path: new URL(c.req.url).pathname,
      body,
    });
    if (!constantTimeEqualHex(signature, expected)) {
      return c.json({ error: "invalid signature" }, 401);
    }

    // Stash the parsed body so route handlers don't re-read it
    // (`c.req.text()` is one-shot on a stream).
    c.set("rawBody", body);
    return next();
  };
}
