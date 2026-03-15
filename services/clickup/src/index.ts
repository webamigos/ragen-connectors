/**
 * FastMCP server for ClickUp — multi-tenant, remote HTTP.
 */

import { FastMCP } from "fastmcp";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { validateEnv } from "@ragen-mcp/core";
import { registerClickupTools } from "./tools/clickup-tools.js";
import { authRouter } from "./auth/oauth.js";

// Validate required env vars
validateEnv([
  "CLICKUP_CLIENT_ID",
  "CLICKUP_CLIENT_SECRET",
  "OAUTH_REDIRECT_URI",
  "RAGEN_TOKEN_VAULT_URL",
  "RAGEN_TOKEN_VAULT_SERVICE_SECRET",
]);

process.env.RAGEN_TOKEN_VAULT_SERVICE_NAME ??= "ragen-mcp-clickup";

const PORT = parseInt(process.env.PORT ?? "8001", 10);

// -- MCP server --
const mcp = new FastMCP({ name: "ClickUp", version: "0.1.0" });
registerClickupTools(mcp);

// -- HTTP app (Hono) for OAuth + health + MCP --
const app = new Hono();

// Health check
app.get("/health", (c) => c.json({ status: "ok", server: "ClickUp MCP" }));

// OAuth routes
app.route("/auth", authRouter);

// Root: handle ClickUp OAuth callback (ClickUp strips paths from redirect URIs)
app.get("/", (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (code && state) {
    return c.redirect(`/auth/callback?code=${code}&state=${state}`);
  }
  return c.json({ status: "ok", server: "ClickUp MCP" });
});

// Start MCP on /mcp via StreamableHTTP and Hono app on the same port
console.log(`Starting ClickUp MCP server on port ${PORT}`);

// Start Hono HTTP server
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`ClickUp HTTP server listening on http://localhost:${info.port}`);
});

// Start MCP server (HTTP streaming on a separate port or same with path)
// FastMCP's httpStream starts its own server, so we use a separate MCP port
const MCP_PORT = PORT + 1000; // e.g., 9001
mcp.start({
  transportType: "httpStream",
  httpStream: { port: MCP_PORT },
});
console.log(`ClickUp MCP endpoint at http://localhost:${MCP_PORT}/mcp`);
