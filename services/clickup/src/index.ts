/**
 * FastMCP server for ClickUp — multi-tenant, remote HTTP.
 */

process.env.OTEL_SERVICE_NAME ??= "ragen-mcp-clickup";

// Must be imported first to set up OTEL before any other imports
import { shutdownOtel } from "@ragen-mcp/core/instrument";

import { FastMCP } from "fastmcp";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { validateEnvVars, logger } from "@ragen-mcp/core";
import { z } from "zod";
import { registerClickupTools } from "./tools/clickup-tools.js";
import { authRouter } from "./auth/oauth.js";

// Validate required env vars
validateEnvVars(
  z.object({
    CLICKUP_CLIENT_ID: z.string(),
    CLICKUP_CLIENT_SECRET: z.string(),
    OAUTH_REDIRECT_URI: z.string(),
    RAGEN_TOKEN_VAULT_URL: z.string(),
    RAGEN_TOKEN_VAULT_SERVICE_SECRET: z.string(),
  }),
);

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

logger.info(`Starting ClickUp MCP server on port ${PORT}`);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`ClickUp HTTP server listening on http://localhost:${info.port}`);
});

const MCP_PORT = PORT + 1000; // e.g., 9001
mcp.start({
  transportType: "httpStream",
  httpStream: { port: MCP_PORT },
});
logger.info(`ClickUp MCP endpoint at http://localhost:${MCP_PORT}/mcp`);

const shutdown = async () => {
  logger.info("Shutting down...");
  await shutdownOtel();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
