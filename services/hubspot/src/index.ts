/**
 * FastMCP server for HubSpot — multi-tenant, remote HTTP.
 */

process.env.OTEL_SERVICE_NAME ??= "ragen-mcp-hubspot";

// Must be imported first to set up OTEL before any other imports
import { shutdownOtel } from "@ragen-connectors/core/instrument";

import { FastMCP } from "fastmcp";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { validateEnvVars, logger } from "@ragen-connectors/core";
import { z } from "zod";
import { registerHubspotTools } from "./tools/hubspot-tools.js";
import { authRouter } from "./auth/oauth.js";

validateEnvVars(
  z.object({
    HUBSPOT_CLIENT_ID: z.string(),
    HUBSPOT_CLIENT_SECRET: z.string(),
    OAUTH_REDIRECT_URI: z.string(),
    RAGEN_TOKEN_VAULT_URL: z.string(),
    RAGEN_TOKEN_VAULT_SERVICE_SECRET: z.string(),
  }),
);

const PORT = parseInt(process.env.PORT ?? "8003", 10);

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

logger.info(`Starting HubSpot MCP server on port ${PORT}`);

serve({ fetch: app.fetch, hostname: "::", port: PORT }, (info) => {
  logger.info(`HubSpot HTTP server listening on port ${info.port} (dual-stack)`);
});

const MCP_PORT = PORT + 1000; // e.g., 9002
mcp.start({
  transportType: "httpStream",
  httpStream: { host: "::", port: MCP_PORT },
});
logger.info(`HubSpot MCP endpoint at http://localhost:${MCP_PORT}/mcp`);

const shutdown = async () => {
  logger.info("Shutting down...");
  await shutdownOtel();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
