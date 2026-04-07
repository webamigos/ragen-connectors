/**
 * FastMCP server for Google — Calendar, Drive, Analytics, Ads & Gmail — multi-tenant, remote HTTP.
 */

process.env.OTEL_SERVICE_NAME ??= "ragen-mcp-google";

// Must be imported first to set up OTEL before any other imports
import { shutdownOtel } from "@ragen-mcp/core/instrument";

import { FastMCP } from "fastmcp";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { validateEnvVars, logger } from "@ragen-mcp/core";
import { z } from "zod";
import { registerCalendarTools } from "./tools/calendar-tools.js";
import { registerDriveTools } from "./tools/drive-tools.js";
import { registerAnalyticsTools } from "./tools/analytics-tools.js";
import { registerAdsTools } from "./tools/ads-tools.js";
import { registerGmailTools } from "./tools/gmail-tools.js";
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

const PORT = parseInt(process.env.PORT ?? "8001", 10);

// -- MCP server --
const mcp = new FastMCP({ name: "Google", version: "0.1.0" });
registerCalendarTools(mcp);
registerDriveTools(mcp);
registerAnalyticsTools(mcp);
registerAdsTools(mcp);
registerGmailTools(mcp);

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
    const rawPageSize = parseInt(c.req.query("page_size") ?? "20", 10);
    const pageSize = Number.isFinite(rawPageSize)
      ? Math.min(Math.max(rawPageSize, 1), 100)
      : 20;
    const data = await drive.searchFiles(
      customerId,
      c.req.query("query") ?? "",
      pageSize,
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
      return c.json(
        {
          success: false,
          error: data.error,
          name: data.name ?? "",
          mime_type: data.mime_type ?? "",
        },
        422,
      );
    }
    return c.json({ success: true, ...data });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// Drive folder listing REST endpoint for ragen-app UI folder picker
app.get("/drive/folder/:folder_id/files", async (c) => {
  const customerId = c.req.query("customer_id");
  if (!customerId) {
    return c.json({ success: false, error: "customer_id is required" }, 400);
  }
  try {
    const folderId = c.req.param("folder_id");
    const rawPageSize = parseInt(c.req.query("page_size") ?? "50", 10);
    const pageSize = Number.isFinite(rawPageSize)
      ? Math.min(Math.max(rawPageSize, 1), 100)
      : 50;
    const [folderMeta, filesData] = await Promise.all([
      drive.getFolderMetadata(customerId, folderId),
      drive.listFolderFiles(customerId, folderId, pageSize, c.req.query("page_token") ?? ""),
    ]);
    return c.json({ success: true, folder_name: folderMeta.name, ...filesData });
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

serve({ fetch: app.fetch, hostname: "::", port: PORT }, (info) => {
  logger.info(`Google HTTP server listening on port ${info.port} (dual-stack)`);
});

const MCP_PORT = PORT + 1000; // e.g., 9003
mcp.start({
  transportType: "httpStream",
  httpStream: { host: "::", port: MCP_PORT },
});
logger.info(`Google MCP endpoint at http://localhost:${MCP_PORT}/mcp`);

const shutdown = async () => {
  logger.info("Shutting down...");
  await shutdownOtel();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
