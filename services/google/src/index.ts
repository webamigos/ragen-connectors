/**
 * FastMCP server for Google — Calendar, Drive, Analytics & Ads — multi-tenant, remote HTTP.
 */

// Must be imported first to set up OTEL before any other imports
import "@ragen-mcp/core/instrument";

import { FastMCP } from "fastmcp";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { validateEnvVars, logger, shutdownOtel } from "@ragen-mcp/core";
import { z } from "zod";
import { registerCalendarTools } from "./tools/calendar-tools.js";
import { registerDriveTools } from "./tools/drive-tools.js";
import { registerAnalyticsTools } from "./tools/analytics-tools.js";
import { registerAdsTools } from "./tools/ads-tools.js";
import { authRouter } from "./auth/oauth.js";
import * as drive from "./services/google-drive.js";

validateEnvVars(
  z.object({
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    OAUTH_REDIRECT_URI: z.string(),
    RAGEN_TOKEN_VAULT_URL: z.string(),
    RAGEN_TOKEN_VAULT_SERVICE_SECRET: z.string(),
  }),
);

process.env.OTEL_SERVICE_NAME ??= "ragen-mcp-google";

const PORT = parseInt(process.env.PORT ?? "8003", 10);

// -- MCP server --
const mcp = new FastMCP({ name: "Google", version: "0.1.0" });
registerCalendarTools(mcp);
registerDriveTools(mcp);
registerAnalyticsTools(mcp);
registerAdsTools(mcp);

// -- HTTP app (Hono) for OAuth + health + Drive REST --
const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", server: "Google MCP" }));

app.route("/auth", authRouter);

// Drive REST endpoints for ragen-app UI file picker
app.get("/drive/search", async (c) => {
  const customerId = c.req.query("customer_id");
  if (!customerId) {
    return c.json({ success: false, error: "customer_id is required" }, 400);
  }
  try {
    const data = await drive.searchFiles(
      customerId,
      c.req.query("query") ?? "",
      parseInt(c.req.query("page_size") ?? "20", 10),
      c.req.query("page_token") ?? "",
      c.req.query("mime_type") ?? "",
    );
    return c.json({ success: true, ...data });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

app.get("/drive/file/:file_id/content", async (c) => {
  const customerId = c.req.query("customer_id");
  if (!customerId) {
    return c.json({ success: false, error: "customer_id is required" }, 400);
  }
  try {
    const data = await drive.getFileContent(customerId, c.req.param("file_id"));
    if (data.error) {
      return c.json({
        success: false,
        error: data.error,
        name: data.name ?? "",
        mime_type: data.mime_type ?? "",
      }, 422);
    }
    return c.json({ success: true, ...data });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// Root: handle OAuth callback redirect
app.get("/", (c) => {
  const code = c.req.query("code");
  if (code) {
    const qs = new URL(c.req.url).searchParams.toString();
    return c.redirect(`/auth/callback?${qs}`);
  }
  return c.json({ status: "ok", server: "Google MCP" });
});

logger.info(`Starting Google MCP server on port ${PORT}`);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Google HTTP server listening on http://localhost:${info.port}`);
});

const MCP_PORT = PORT + 1000; // e.g., 9003
mcp.start({
  transportType: "httpStream",
  httpStream: { port: MCP_PORT },
});
logger.info(`Google MCP endpoint at http://localhost:${MCP_PORT}/mcp`);

const shutdown = async () => {
  logger.info("Shutting down...");
  await shutdownOtel();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
