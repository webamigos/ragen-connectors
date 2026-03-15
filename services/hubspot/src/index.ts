/**
 * FastMCP server for HubSpot — multi-tenant, remote HTTP.
 */

import { FastMCP } from "fastmcp";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { validateEnv } from "@ragen-mcp/core";
import { registerHubspotTools } from "./tools/hubspot-tools.js";
import { authRouter } from "./auth/oauth.js";

validateEnv([
  "HUBSPOT_CLIENT_ID",
  "HUBSPOT_CLIENT_SECRET",
  "OAUTH_REDIRECT_URI",
  "RAGEN_TOKEN_VAULT_URL",
  "RAGEN_TOKEN_VAULT_SERVICE_SECRET",
]);

process.env.OTEL_SERVICE_NAME ??= "ragen-mcp-hubspot";

const PORT = parseInt(process.env.PORT ?? "8002", 10);

// -- MCP server --
const mcp = new FastMCP({ name: "HubSpot", version: "0.1.0" });
registerHubspotTools(mcp);

// -- HTTP app (Hono) for OAuth + health --
const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", server: "HubSpot MCP" }));

app.route("/auth", authRouter);

// Root: handle OAuth callback redirect
app.get("/", (c) => {
  const code = c.req.query("code");
  if (code) {
    const qs = new URL(c.req.url).searchParams.toString();
    return c.redirect(`/auth/callback?${qs}`);
  }
  return c.json({ status: "ok", server: "HubSpot MCP" });
});

console.log(`Starting HubSpot MCP server on port ${PORT}`);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`HubSpot HTTP server listening on http://localhost:${info.port}`);
});

const MCP_PORT = PORT + 1000; // e.g., 9002
mcp.start({
  transportType: "httpStream",
  httpStream: { port: MCP_PORT },
});
console.log(`HubSpot MCP endpoint at http://localhost:${MCP_PORT}/mcp`);
