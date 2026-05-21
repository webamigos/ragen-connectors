import { validateEnvVars } from "@ragen-mcp/core";
import { z } from "zod";

/**
 * Env schema for the rejestrio service.
 *
 * Note on `REJESTRIO_API_KEY`: the upstream API expects this value to
 * appear verbatim in the `Authorization` header with NO `Bearer`
 * prefix. The client wraps this for you; don't set the header
 * yourself elsewhere.
 */
export const env = validateEnvVars(
  z.object({
    DATABASE_URL: z.string().url(),
    REJESTRIO_API_KEY: z.string().min(1),
    REJESTRIO_BASE_URL: z
      .string()
      .url()
      .default("https://rejestr.io/api/v2"),
    REJESTRIO_PLAN_TIER: z
      .enum(["base", "premium", "biznes"])
      .default("base"),
    REJESTRIO_DEFAULT_DAILY_BUDGET_PLN: z.coerce
      .number()
      .positive()
      .default(20),
    /**
     * Hard kill-switch. When true, the service refuses any call that
     * would hit Rejestr.io and serves only from cache. Useful for
     * incident response.
     */
    REJESTRIO_DISABLE_PAID_CALLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /**
     * Hono HTTP port. MCP httpStream runs on PORT + 1000.
     *
     * Avoid 8001–8003 — taken by google / clickup / hubspot
     * respectively. 8004 is the next free slot across the monorepo
     * (→ MCP stream on 9004).
     */
    PORT: z.coerce.number().int().positive().default(8004),
    /**
     * Shared secret used to HMAC-sign server-to-server calls to the
     * `/enrich/*` HTTP routes (ragen-app's leads pipeline). Must match
     * the value set in ragen-app's `REJESTRIO_ENRICH_SECRET`.
     *
     * Unrelated to the upstream Rejestr.io API key and to MCP
     * transport — those endpoints stay open per their own auth.
     */
    ENRICH_API_SECRET: z.string().min(32).optional(),
  }),
);
