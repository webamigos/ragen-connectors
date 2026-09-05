/**
 * MCP tool: `get_krs_chapter`
 *
 * Generic access to endpoint 03 (`krs-rozdzialy`) for chapters beyond
 * `ogolny` (which `get_krs_info` already surfaces). Returns the raw
 * chapter payload — the model reads specific fields as needed.
 *
 * Supported chapters and what they typically contain:
 *   - `oddzialy` — branch offices (Premium+)
 *   - `akcje` — share-capital details for S.A. companies
 *   - `wzmianki` — legal remarks / notations
 *   - `zobowiazania` — obligations / liabilities (Premium+)
 *   - `przeksztalcenia` — legal-form transformations history (Premium+)
 *
 * Kept as a single generic tool (rather than five specialised ones)
 * because the endpoint is itself generic and adding per-chapter tools
 * bloats the model's tool list for data rarely queried.
 *
 * Cost: 0.05 PLN per uncached call. Not cached at the MCP layer (v1).
 */
import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { logger } from "@ragen-connectors/core";
import type { RejestrioClient } from "../client/rejestrio-client.js";
import type { BudgetGuard } from "../audit/budget-guard.js";
import { ENDPOINTS, toApiKrs, toCanonicalKrs } from "../client/endpoints.js";
import { parseCustomerId } from "./customer-id.js";

export type GetKrsChapterDeps = {
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
  chapter: z.enum([
    "oddzialy",
    "akcje",
    "wzmianki",
    "zobowiazania",
    "przeksztalcenia",
  ]),
});

type GetKrsChapterParams = z.infer<typeof paramsSchema>;

export type GetKrsChapterResult =
  | {
      success: true;
      krs: number;
      krsPadded: string;
      chapter: GetKrsChapterParams["chapter"];
      empty: boolean;
      data: unknown;
    }
  | { success: false; error: string };

export async function handleGetKrsChapter(
  input: GetKrsChapterParams,
  { client, budget }: GetKrsChapterDeps,
): Promise<GetKrsChapterResult> {
  const krsNum = Number(String(input.krs).replace(/^0+/, "") || "0");
  const krsApi = toApiKrs(krsNum);
  const krsPadded = toCanonicalKrs(krsNum);
  const { orgId, userId } = parseCustomerId(input.customer_id);

  try {
    await budget.assertAllowed(orgId, ENDPOINTS["03"].costPln);
    const raw = await client.get(
      "03",
      `/org/${krsApi}/krs-rozdzialy/${input.chapter}`,
      undefined,
      { orgId, userId, krs: krsNum },
    );
    // Endpoint 03 can return `[]` (empty) for wykreślone entries.
    // Surface that explicitly so the model doesn't mistake an empty
    // array for "missing data".
    const empty = Array.isArray(raw) && raw.length === 0;
    return {
      success: true,
      krs: krsNum,
      krsPadded,
      chapter: input.chapter,
      empty,
      data: raw,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: msg, krs: krsNum, chapter: input.chapter },
      "get_krs_chapter failed",
    );
    return { success: false, error: msg };
  }
}

export function registerGetKrsChapter(
  mcp: FastMCP,
  deps: GetKrsChapterDeps,
): void {
  mcp.addTool({
    name: "get_krs_chapter",
    description:
      "Fetch a specific KRS chapter for an organisation beyond the default " +
      "'ogolny' that `get_krs_info` already returns. Chapters: " +
      "'oddzialy' (branches), 'akcje' (share capital for S.A.), 'wzmianki' " +
      "(legal remarks), 'zobowiazania' (obligations), 'przeksztalcenia' " +
      "(legal-form history). oddzialy / zobowiazania / przeksztalcenia " +
      "require Rejestr.io Premium. Cost: 0.05 PLN per call.",
    parameters: paramsSchema,
    execute: async (input) =>
      JSON.stringify(await handleGetKrsChapter(input, deps)),
  });
}
