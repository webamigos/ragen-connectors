/**
 * ClickUp OAuth2 flow endpoints (Hono router).
 */

import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { saveState, popState } from "@ragen-mcp/core";
import { saveTokens, getAccessToken } from "./token-store.js";

const CLICKUP_CLIENT_ID = process.env.CLICKUP_CLIENT_ID ?? "";
const CLICKUP_CLIENT_SECRET = process.env.CLICKUP_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI ?? "http://localhost:8002/auth/callback";

export const authRouter = new Hono();

authRouter.get("/clickup", async (c) => {
  const customerId = c.req.query("customer_id");
  const redirectUri = c.req.query("redirect_uri") ?? "";

  if (!customerId) {
    return c.json({ error: "customer_id is required" }, 400);
  }
  if (!CLICKUP_CLIENT_ID || !CLICKUP_CLIENT_SECRET) {
    return c.json({ error: "ClickUp OAuth credentials not configured" }, 500);
  }

  const state = randomBytes(32).toString("base64url");
  saveState(state, customerId, redirectUri);

  const params = new URLSearchParams({
    client_id: CLICKUP_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
  });

  return c.redirect(`https://app.clickup.com/api?${params.toString()}`);
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

  // Exchange authorization code for access token
  let accessToken: string;
  try {
    const resp = await fetch(
      `https://api.clickup.com/api/v2/oauth/token?${new URLSearchParams({
        client_id: CLICKUP_CLIENT_ID,
        client_secret: CLICKUP_CLIENT_SECRET,
        code,
      })}`,
      { method: "POST" },
    );
    if (!resp.ok) {
      return c.json(
        { error: "Failed to exchange authorization code with ClickUp" },
        502,
      );
    }
    const data = (await resp.json()) as { access_token?: string };
    if (!data.access_token) {
      return c.json({ error: "Invalid token response from ClickUp" }, 502);
    }
    accessToken = data.access_token;
  } catch {
    return c.json({ error: "Failed to connect to ClickUp" }, 502);
  }

  await saveTokens(customerId, accessToken);

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
        <p>Customer <strong>${escapeHtml(customerId)}</strong> has been connected to ClickUp.</p>
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
