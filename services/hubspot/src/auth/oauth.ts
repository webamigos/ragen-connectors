/**
 * HubSpot OAuth2 flow endpoints (Hono router).
 */

import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { saveState, popState } from "@ragen-mcp/core";
import { saveTokens, getAccessToken } from "./token-store.js";

const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID ?? "";
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI ?? "http://localhost:8002/auth/callback";
const HUBSPOT_AUTH_DOMAIN =
  process.env.HUBSPOT_AUTH_DOMAIN ?? "app.hubspot.com";

const SCOPES =
  "oauth crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read crm.objects.owners.read";

export const authRouter = new Hono();

authRouter.get("/hubspot", async (c) => {
  const customerId = c.req.query("customer_id");
  const redirectUri = c.req.query("redirect_uri") ?? "";

  if (!customerId) {
    return c.json({ error: "customer_id is required" }, 400);
  }
  if (!HUBSPOT_CLIENT_ID || !HUBSPOT_CLIENT_SECRET) {
    return c.json({ error: "HubSpot OAuth credentials not configured" }, 500);
  }

  const state = randomBytes(32).toString("base64url");
  saveState(state, customerId, redirectUri);

  const params = new URLSearchParams({
    client_id: HUBSPOT_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  });

  return c.redirect(
    `https://${HUBSPOT_AUTH_DOMAIN}/oauth/authorize?${params.toString()}`,
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

  // Exchange authorization code for tokens
  let accessToken: string;
  let refreshToken: string;
  try {
    const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: HUBSPOT_CLIENT_ID,
        client_secret: HUBSPOT_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      return c.json(
        { error: "Failed to exchange authorization code with HubSpot" },
        502,
      );
    }
    const data = (await resp.json()) as Record<string, unknown>;
    if (
      typeof data.access_token !== "string" ||
      typeof data.refresh_token !== "string"
    ) {
      return c.json({ error: "Invalid token response from HubSpot" }, 502);
    }
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
  } catch {
    return c.json({ error: "Failed to connect to HubSpot" }, 502);
  }

  await saveTokens(customerId, accessToken, refreshToken);

  if (redirectUri) {
    const params = new URLSearchParams({
      status: "success",
      customer_id: customerId,
    });
    return c.redirect(`${redirectUri}?${params.toString()}`);
  }

  return c.html(`
    <html>
    <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
      <div style="text-align: center; padding: 2rem;">
        <h1>Authentication Successful</h1>
        <p>Customer <strong>${escapeHtml(customerId)}</strong> has been connected to HubSpot.</p>
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
    await getAccessToken(customerId);
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
