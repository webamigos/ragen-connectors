/**
 * Google OAuth2 flow endpoints (Hono router).
 */

import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { saveState, popState } from "@ragen-mcp/core";
import { saveTokens, refreshAndGetToken } from "./token-store.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI ?? "http://localhost:8001/auth/callback";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/adwords",
].join(" ");

export const authRouter = new Hono();

authRouter.get("/google", async (c) => {
  const customerId = c.req.query("customer_id");
  const redirectUri = c.req.query("redirect_uri") ?? "";

  if (!customerId) {
    return c.json({ error: "customer_id is required" }, 400);
  }
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return c.json({ error: "Google OAuth credentials not configured" }, 500);
  }

  const state = randomBytes(32).toString("base64url");
  saveState(state, customerId, redirectUri);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return c.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
});

authRouter.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Missing code or state parameter" }, 400);
  }

  const pending = popState(state);
  if (!pending) {
    return c.json({ error: "Invalid or expired OAuth state" }, 400);
  }

  const { customerId, redirectUri } = pending;

  let accessToken: string;
  let refreshToken: string;
  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      return c.json(
        { error: "Failed to exchange authorization code with Google" },
        502,
      );
    }
    const data = (await resp.json()) as Record<string, unknown>;
    if (
      typeof data.access_token !== "string" ||
      typeof data.refresh_token !== "string"
    ) {
      return c.json({ error: "Invalid token response from Google" }, 502);
    }
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
  } catch {
    return c.json({ error: "Failed to connect to Google" }, 502);
  }

  await saveTokens(customerId, accessToken, refreshToken);

  if (redirectUri) {
    const ALLOWED_ORIGINS = (process.env.ALLOWED_REDIRECT_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let finalUrl: URL;
    try {
      finalUrl = new URL(redirectUri);
    } catch {
      return c.json({ error: "Invalid redirect_uri" }, 400);
    }
    if (
      ALLOWED_ORIGINS.length > 0 &&
      !ALLOWED_ORIGINS.includes(finalUrl.origin)
    ) {
      return c.json({ error: "redirect_uri origin not allowed" }, 400);
    }
    finalUrl.searchParams.set("status", "success");
    finalUrl.searchParams.set("customer_id", customerId);
    return c.redirect(finalUrl.toString());
  }

  return c.html(`
    <html>
    <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
      <div style="text-align: center; padding: 2rem;">
        <h1>Authentication Successful</h1>
        <p>Customer <strong>${escapeHtml(customerId)}</strong> has been connected to Google.</p>
        <p>You can close this window and return to the application.</p>
      </div>
    </body>
    </html>
  `);
});

authRouter.get("/status", async (c) => {
  const customerId = c.req.query("customer_id");
  if (!customerId) {
    return c.json({ error: "customer_id is required" }, 400);
  }
  try {
    await refreshAndGetToken(customerId);
    return c.json({ customer_id: customerId, authenticated: true });
  } catch {
    return c.json({ customer_id: customerId, authenticated: false });
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
