import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { catalogueEntry, type CatalogueEntry } from "./catalogue.js";
import type { AuthType } from "./args.js";
import {
  MCP_PORT_OFFSET,
  insertPortRow,
  parsePortTable,
  portConflict,
} from "./port-table.js";
import { render, unresolvedTokens, type RenderedFiles } from "./render.js";
import type { Target } from "./workspace.js";

/**
 * Everything the CLI decided, as one value — so the plan can be built, checked
 * and printed before a single file is written.
 *
 * The separation matters: a scaffolder that writes as it goes and fails
 * halfway leaves a directory that is neither the old state nor the new one,
 * and a standalone target has no git to undo it with.
 */
export interface ScaffoldPlan {
  slug: string;
  label: string;
  description: string;
  icon: string;
  auth: AuthType;
  port: number;
  target: Target;
  /** Where the service is written. */
  destination: string;
  /** The monorepo root, for a workspace target. */
  workspaceRoot: string | null;
  cliVersion: string;
}

export interface ScaffoldResult {
  files: string[];
  entry: CatalogueEntry;
  /** Documents whose port table gained a row. */
  portTablesUpdated: string[];
}

/** The files a plan produces, before any of them exist. */
export function planFiles(plan: ScaffoldPlan): RenderedFiles {
  const files = render({
    slug: plan.slug,
    label: plan.label,
    description: plan.description,
    port: plan.port,
    auth: plan.auth,
    icon: plan.icon,
    target: plan.target,
    cliVersion: plan.cliVersion,
  });

  const entry = catalogueEntry(plan);
  files.set("ragen-connector.json", `${JSON.stringify(entry, null, 2)}\n`);

  // A token nobody defines renders as itself, and a generated file containing
  // `__LABEL_IDENT__` would fail to compile with a message pointing at the
  // author's code rather than at this CLI. Fail here, where the cause is.
  const unresolved = unresolvedTokens(files);
  if (unresolved.length > 0) {
    throw new Error(
      `Templates refer to tokens nothing defines: ${unresolved.join(", ")}. This is a bug in create-ragen-connector.`,
    );
  }

  return files;
}

/** The port table documents a workspace target has to keep in step. */
export const PORT_TABLE_DOCUMENTS = ["AGENTS.md", "docs/architecture.md"];

export function scaffold(plan: ScaffoldPlan): ScaffoldResult {
  const files = planFiles(plan);

  // Everything is rendered before anything is written, the port tables
  // included. They used to be updated *after* the service files, so a document
  // whose table had moved threw with a service already on disk — a half
  // scaffold that the next run then refuses as a non-empty directory, which is
  // the one state this CLI can leave that nobody can recover from.
  const tables = plan.workspaceRoot
    ? planPortTables(plan.workspaceRoot, plan.slug, plan.port)
    : [];

  const written: string[] = [];
  for (const [relativePath, body] of files) {
    const full = join(plan.destination, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, "utf8");
    written.push(relativePath);
  }

  for (const table of tables) {
    writeFileSync(table.path, table.contents, "utf8");
  }

  return {
    files: written.sort(),
    entry: catalogueEntry(plan),
    portTablesUpdated: tables.map((table) => table.relativePath),
  };
}

export interface PlannedPortTable {
  /** Absolute path to write. */
  path: string;
  relativePath: string;
  contents: string;
}

/**
 * The new contents of every port table in the repository — computed, not
 * written.
 *
 * Both documents, always: they are the same table written twice, and a pair
 * that disagrees is worse than one that is missing, because the wrong one is
 * as likely to be read. A document that is absent is a fork that does not
 * carry it and is skipped; a document that is *present* and has no table is a
 * refusal, because silently updating one of the two is how a service ends up
 * with ports only half claimed.
 */
export function planPortTables(
  root: string,
  service: string,
  http: number,
): PlannedPortTable[] {
  const planned: PlannedPortTable[] = [];
  for (const relativePath of PORT_TABLE_DOCUMENTS) {
    const path = join(root, relativePath);
    if (!existsSync(path)) {
      continue;
    }
    // Any other read failure — a permission, a directory where a file should
    // be — throws, before a single file has been written.
    const markdown = readFileSync(path, "utf8");
    planned.push({
      path,
      relativePath,
      contents: insertPortRow(markdown, {
        service,
        http,
        mcp: http + MCP_PORT_OFFSET,
      }),
    });
  }
  return planned;
}

/** The ports already claimed in the repository, for allocation and conflict checks. */
export function claimedPorts(root: string): ReturnType<typeof parsePortTable> {
  try {
    return parsePortTable(readFileSync(join(root, "AGENTS.md"), "utf8"));
  } catch {
    return [];
  }
}

export { portConflict };
