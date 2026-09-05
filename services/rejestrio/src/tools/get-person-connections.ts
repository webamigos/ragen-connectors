/**
 * MCP tool: `get_person_connections`
 *
 * Lists organisations a given person is (or was) connected to via KRS
 * — their directorships, shareholdings, and supervisory roles across
 * the register. Useful for "does this person sit on other boards?"
 * questions and for spotting conflicts of interest during lead
 * scoring.
 *
 * Rejestr.io endpoint 07. Supports `aktualnosc=aktualne|historyczne`
 * (historyczne requires Premium+). Cost: 0.05 PLN per call.
 */
import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { logger } from "@ragen-connectors/core";
import type { RejestrioClient } from "../client/rejestrio-client.js";
import type { BudgetGuard } from "../audit/budget-guard.js";
import { ENDPOINTS } from "../client/endpoints.js";
import { personConnectionsResponseSchema } from "../schemas/person.js";
import { parseCustomerId } from "./customer-id.js";

export type GetPersonConnectionsDeps = {
  client: RejestrioClient;
  budget: BudgetGuard;
};

const paramsSchema = z.object({
  customer_id: z.string().min(1),
  personId: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .transform((v) => Number(v)),
  /**
   * `aktualne` for current connections (default), `historyczne` for
   * past. `historyczne` requires Rejestr.io Premium+.
   */
  aktualnosc: z.enum(["aktualne", "historyczne"]).optional().default("aktualne"),
});

type GetPersonConnectionsParams = z.infer<typeof paramsSchema>;

export type GetPersonConnectionsResult =
  | {
      success: true;
      personId: number;
      aktualnosc: "aktualne" | "historyczne";
      connections: unknown[];
    }
  | { success: false; error: string };

export async function handleGetPersonConnections(
  input: GetPersonConnectionsParams,
  { client, budget }: GetPersonConnectionsDeps,
): Promise<GetPersonConnectionsResult> {
  const { orgId, userId } = parseCustomerId(input.customer_id);
  const aktualnosc = input.aktualnosc ?? "aktualne";
  try {
    await budget.assertAllowed(orgId, ENDPOINTS["07"].costPln);
    const raw = await client.get(
      "07",
      `/osoby/${input.personId}/krs-powiazania`,
      { aktualnosc },
      { orgId, userId },
    );
    const parsed = personConnectionsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { personId: input.personId, issues: parsed.error.issues.slice(0, 5) },
        "get_person_connections: response failed schema validation",
      );
      return {
        success: false,
        error:
          "Unexpected person-connections response shape from Rejestr.io",
      };
    }
    return {
      success: true,
      personId: input.personId,
      aktualnosc,
      connections: parsed.data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, personId: input.personId },
      "get_person_connections failed",
    );
    return { success: false, error: msg };
  }
}

export function registerGetPersonConnections(
  mcp: FastMCP,
  deps: GetPersonConnectionsDeps,
): void {
  mcp.addTool({
    name: "get_person_connections",
    description:
      "List organisations a person is connected to via KRS — current " +
      "directorships, shareholdings, supervisory roles. Pass `aktualnosc: " +
      "'historyczne'` for past roles (Rejestr.io Premium+ required). " +
      "Cost: 0.05 PLN per call.",
    parameters: paramsSchema,
    execute: async (input) =>
      JSON.stringify(await handleGetPersonConnections(input, deps)),
  });
}
