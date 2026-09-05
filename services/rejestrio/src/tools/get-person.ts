/**
 * MCP tool: `get_person`
 *
 * Look up a person in Rejestr.io by their numeric id. The id comes
 * from endpoint 06 (krs-powiazania) — every board member / shareholder
 * / related person carries a Rejestr.io `id` which references the
 * person's profile. Useful for enriching board lists ("what's the
 * full DOB / nationality of prezes?") and for piping into
 * get_person_connections (endpoint 07) to see where else they sit.
 *
 * Cost: 0.05 PLN per call. Not cached — person profiles are small
 * and typically queried ad-hoc.
 */
import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { logger } from "@ragen-connectors/core";
import type { RejestrioClient } from "../client/rejestrio-client.js";
import type { BudgetGuard } from "../audit/budget-guard.js";
import { ENDPOINTS } from "../client/endpoints.js";
import { personResponseSchema } from "../schemas/person.js";
import { parseCustomerId } from "./customer-id.js";

export type GetPersonDeps = {
  client: RejestrioClient;
  budget: BudgetGuard;
};

const paramsSchema = z.object({
  customer_id: z.string().min(1),
  personId: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .transform((v) => Number(v)),
});

type GetPersonParams = z.infer<typeof paramsSchema>;

export type GetPersonResult =
  | { success: true; id: number; person: unknown }
  | { success: false; error: string };

export async function handleGetPerson(
  input: GetPersonParams,
  { client, budget }: GetPersonDeps,
): Promise<GetPersonResult> {
  const { orgId, userId } = parseCustomerId(input.customer_id);
  try {
    await budget.assertAllowed(orgId, ENDPOINTS["04"].costPln);
    const raw = await client.get(
      "04",
      `/osoby/${input.personId}`,
      undefined,
      { orgId, userId },
    );
    const parsed = personResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { personId: input.personId, issues: parsed.error.issues.slice(0, 5) },
        "get_person: response failed schema validation",
      );
      return {
        success: false,
        error: "Unexpected person-data response shape from Rejestr.io",
      };
    }
    return { success: true, id: input.personId, person: parsed.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, personId: input.personId }, "get_person failed");
    return { success: false, error: msg };
  }
}

export function registerGetPerson(mcp: FastMCP, deps: GetPersonDeps): void {
  mcp.addTool({
    name: "get_person",
    description:
      "Look up a person in Rejestr.io by their internal id (obtained from " +
      "`get_krs_info`'s powiazania[].id). Returns imiona, nazwisko, date of " +
      "birth, sex. Cost: 0.05 PLN per call.",
    parameters: paramsSchema,
    execute: async (input) =>
      JSON.stringify(await handleGetPerson(input, deps)),
  });
}
