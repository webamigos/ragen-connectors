/**
 * The `weather` connector — an MCP server a Ragen installation connects to.
 *
 * The display name is `NAME` below. It is free text somebody typed, so it is
 * kept out of comments entirely — a label carrying a block-comment terminator
 * would close this one and put the rest of itself into the file as code.
 *
 * Two listeners, always: Hono on PORT for health and REST, FastMCP on
 * PORT + 1000 for `/mcp`. FastMCP owns its own listener and cannot be mounted
 * on the Hono app. A service whose MCP port is unmapped passes its health
 * check and is unusable, and the client reports it as "no tools".
 */

// OTEL patches modules at import time, so the service name has to be set
// before any import runs — and an ESM `process.env.X ??=` line below would
// run *after* them. Set OTEL_SERVICE_NAME in the environment instead; the
// generated .env.example already does.
import { shutdownOtel } from "./runtime/instrument.js";

import { FastMCP } from "fastmcp";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { validateEnvVars, logger } from "./runtime/index.js";
import { authenticate } from "./auth.js";
import { registerWeatherTools } from "./tools/example-tools.js";

// The ceiling is 64535 rather than 65535 because the MCP listener is
// PORT + 1000 and has to fit too. Without that bound `PORT=65000` starts Hono
// on a valid port and leaves MCP unable to bind — a service that passes its
// health check and has no tools, which is the failure this file's header is
// about. `PORT=0` would ask the OS for an ephemeral port, which nothing could
// then dial.
/**
 * The service's own name, stated once.
 *
 * It is free text somebody typed, so it appears in exactly one string literal
 * and every other use references this constant. Interpolating it into the log
 * template literals below instead would mean escaping it two different ways
 * for two different quotings of the same language.
 */
const NAME = "Weather";

const { PORT } = validateEnvVars(
  z.object({
    PORT: z.coerce.number().int().min(1024).max(64535).default(8005),
  }),
);

const mcp = new FastMCP({
  name: NAME,
  version: "0.1.0",
  authenticate,
});
registerWeatherTools(mcp);

const app = new Hono();

// Ragen does not call this; it is for your platform's health checks. It
// deliberately says nothing about whether the MCP listener came up — see the
// note at the top of this file, and check `/mcp` separately.
app.get("/health", (c) => c.json({ status: "ok", server: `${NAME} MCP` }));

serve({ fetch: app.fetch, hostname: "::", port: PORT }, (info) => {
  logger.info(`${NAME} HTTP server listening on port ${info.port} (dual-stack)`);
});

const MCP_PORT = PORT + 1000;
mcp.start({
  transportType: "httpStream",
  httpStream: { host: "::", port: MCP_PORT },
});
logger.info(`${NAME} MCP endpoint at http://localhost:${MCP_PORT}/mcp`);

const shutdown = async () => {
  logger.info("Shutting down...");
  await shutdownOtel();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
