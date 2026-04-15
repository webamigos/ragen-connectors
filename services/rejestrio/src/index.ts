/**
 * FastMCP server for Rejestr.io — Polish company registry data.
 *
 * Unlike the other ragen-mcp services (Google, HubSpot, ClickUp),
 * authentication is a single service-wide API key, not per-user
 * OAuth. There's no `/auth/*` router and no token-vault integration.
 */
process.env.OTEL_SERVICE_NAME ??= "ragen-mcp-rejestrio";

// OTEL import must come first — sets up instrumentation before any
// other module loads its instrumented SDKs.
import { shutdownOtel } from "@ragen-mcp/core/instrument";

import { FastMCP } from "fastmcp";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "@ragen-mcp/core";

import { env } from "./env.js";
import { getDb, disconnectDb } from "./db/client.js";
import { RejestrioClient } from "./client/rejestrio-client.js";
import { RequestAuditRepository } from "./audit/request-audit-repo.js";
import { BudgetGuard } from "./audit/budget-guard.js";
import { CompanyProfileRepository } from "./cache/company-profile-repo.js";
import { FinancialDocumentRepository } from "./cache/financial-doc-repo.js";
import { registerLookupCompany } from "./tools/lookup-company.js";
import { registerGetKrsInfo } from "./tools/get-krs-info.js";
import { registerGetKrsHistory } from "./tools/get-krs-history.js";
import { registerGetFinancials } from "./tools/get-financials.js";

const db = getDb();
const audit = new RequestAuditRepository(db);
const budget = new BudgetGuard({
  audit,
  defaultDailyBudgetPln: env.REJESTRIO_DEFAULT_DAILY_BUDGET_PLN,
  disabled: env.REJESTRIO_DISABLE_PAID_CALLS,
});
const profiles = new CompanyProfileRepository(db);
const finDocs = new FinancialDocumentRepository(db);

const client = new RejestrioClient({
  apiKey: env.REJESTRIO_API_KEY,
  baseUrl: env.REJESTRIO_BASE_URL,
  onCallComplete: async (outcome) => {
    // Every upstream hit lands in the audit log, even failures —
    // we need the full cost picture, not just the successful calls.
    // `ctx` carries the calling org/user + target identifiers so the
    // row is fully attributed.
    await audit.record({
      endpoint: outcome.endpoint,
      httpStatus: outcome.httpStatus,
      latencyMs: outcome.latencyMs,
      costPln: outcome.costPln,
      orgId: outcome.ctx.orgId ?? null,
      userId: outcome.ctx.userId ?? null,
      krs: outcome.ctx.krs ?? null,
      nip: outcome.ctx.nip ?? null,
      cached: false,
      error:
        outcome.error instanceof Error
          ? outcome.error.message
          : outcome.error
            ? String(outcome.error)
            : null,
    });
  },
});

// --- MCP server ---
const mcp = new FastMCP({ name: "Rejestrio", version: "0.1.0" });
registerLookupCompany(mcp, { client, budget });
registerGetKrsInfo(mcp, { client, budget, profiles });
registerGetKrsHistory(mcp, { client, budget, profiles });
registerGetFinancials(mcp, { client, budget, profiles, finDocs });

// --- HTTP app (Hono) for health only ---
const app = new Hono();

app.get("/health", (c) =>
  c.json({
    status: "ok",
    server: "Rejestrio MCP",
    planTier: env.REJESTRIO_PLAN_TIER,
    paidCallsDisabled: env.REJESTRIO_DISABLE_PAID_CALLS,
  }),
);

app.get("/", (c) =>
  c.json({ server: "Rejestrio MCP", hint: "GET /health for status" }),
);

// --- start ---
serve(
  { fetch: app.fetch, port: env.PORT },
  (info) => {
    logger.info(
      { port: info.port, planTier: env.REJESTRIO_PLAN_TIER },
      "Rejestrio MCP HTTP server listening",
    );
  },
);

// FastMCP http stream on PORT + 1000 — matches the google/hubspot
// pattern so it's predictable where clients connect (9004 by default;
// 9001–9003 are taken by google/clickup/hubspot).
const mcpPort = env.PORT + 1000;
void mcp.start({
  transportType: "httpStream",
  httpStream: { port: mcpPort },
});
logger.info({ port: mcpPort }, "Rejestrio MCP httpStream listening");

// Graceful shutdown — finish in-flight DB writes + flush OTEL.
async function shutdown(signal: string) {
  logger.info({ signal }, "Rejestrio MCP shutting down");
  try {
    await disconnectDb();
  } catch (err) {
    logger.warn({ err }, "Error during DB disconnect");
  }
  try {
    await shutdownOtel();
  } catch (err) {
    logger.warn({ err }, "Error during OTEL shutdown");
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
