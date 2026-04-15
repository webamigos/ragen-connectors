/**
 * MCP tool: `get_beneficial_owners`
 *
 * Fetches ultimate beneficial owners (UBOs) for a Polish company from
 * the **Centralny Rejestr Beneficjentów Rzeczywistych (CRBR)** — the
 * Ministry of Finance's standalone register, separate from KRS. For
 * B2B scoring this is the definitive "who actually controls this
 * entity" answer — critical for compliance (AML / KYC) and for
 * resolving ownership through holding structures that KRS only shows
 * one layer deep.
 *
 * Source: Rejestr.io endpoint 05 (/org/{id}/crbr). Requires Premium.
 * Cost: 0.05 PLN per call. Not cached at the MCP layer (v1).
 */
import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { logger } from "@ragen-mcp/core";
import type { RejestrioClient } from "../client/rejestrio-client.js";
import type { BudgetGuard } from "../audit/budget-guard.js";
import { ENDPOINTS, toApiKrs, toCanonicalKrs } from "../client/endpoints.js";
import { crbrResponseSchema } from "../schemas/crbr.js";
import { parseCustomerId } from "./customer-id.js";

export type GetBeneficialOwnersDeps = {
  client: RejestrioClient;
  budget: BudgetGuard;
};

const paramsSchema = z.object({
  customer_id: z.string().min(1),
  krs: z
    .union([z.string(), z.number()])
    .refine((v) => /^\d{1,10}$/.test(String(v).replace(/^0+/, "") || "0"), {
      message: "KRS must be 1–10 digits",
    }),
});

type GetBeneficialOwnersParams = z.infer<typeof paramsSchema>;

export type GetBeneficialOwnersResult =
  | {
      success: true;
      krs: number;
      krsPadded: string;
      beneficialOwners: unknown[];
    }
  | { success: false; error: string };

export async function handleGetBeneficialOwners(
  input: GetBeneficialOwnersParams,
  { client, budget }: GetBeneficialOwnersDeps,
): Promise<GetBeneficialOwnersResult> {
  const krsNum = Number(String(input.krs).replace(/^0+/, "") || "0");
  const krsApi = toApiKrs(krsNum);
  const krsPadded = toCanonicalKrs(krsNum);
  const { orgId, userId } = parseCustomerId(input.customer_id);

  try {
    await budget.assertAllowed(orgId, ENDPOINTS["05"].costPln);
    const raw = await client.get(
      "05",
      `/org/${krsApi}/crbr`,
      undefined,
      { orgId, userId, krs: krsNum },
    );
    const parsed = crbrResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { krs: krsNum, issues: parsed.error.issues.slice(0, 5) },
        "get_beneficial_owners: response failed schema validation",
      );
      return {
        success: false,
        error: "Unexpected CRBR response shape from Rejestr.io",
      };
    }
    return {
      success: true,
      krs: krsNum,
      krsPadded,
      beneficialOwners: parsed.data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, krs: krsNum }, "get_beneficial_owners failed");
    return { success: false, error: msg };
  }
}

export function registerGetBeneficialOwners(
  mcp: FastMCP,
  deps: GetBeneficialOwnersDeps,
): void {
  mcp.addTool({
    name: "get_beneficial_owners",
    description:
      "Fetch Ultimate Beneficial Owners (UBOs) for a Polish company from CRBR " +
      "(Centralny Rejestr Beneficjentów Rzeczywistych). Separate register " +
      "from KRS — resolves ownership through holding structures. " +
      "Requires Rejestr.io Premium. Cost: 0.05 PLN per call.",
    parameters: paramsSchema,
    execute: async (input) =>
      JSON.stringify(await handleGetBeneficialOwners(input, deps)),
  });
}
