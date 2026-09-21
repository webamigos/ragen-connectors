import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { catalogueEntry, type CatalogueEntry } from "./catalogue.js";
import type { AuthType } from "./args.js";
import {
  MCP_PORT_OFFSET,
  insertPortRow,
  parsePortTable,
  portConflict,
  type PortRow,
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

  // Whether this run is the one that created the destination. If the operator
  // pointed the CLI at a directory that already existed (empty, or it would
  // have been refused), rolling back must not delete *their* directory.
  const destinationIsOurs = !existsSync(plan.destination);

  const written: string[] = [];
  /** Directories this run created, so a rollback removes only those. */
  const madeDirectories = new Set<string>();
  const restore: Array<() => void> = [];

  try {
    for (const [relativePath, body] of files) {
      const full = join(plan.destination, relativePath);
      // `mkdirSync` with `recursive` returns the **first** path it created —
      // the shallowest, not the leaf — and `undefined` when everything already
      // existed. That return value is the root of a subtree that did not exist
      // before this run, so it is exactly what the rollback may remove whole.
      //
      // Recording the leaf instead left `src` behind: writing
      // `src/tools/example-tools.ts` creates `src` *and* `src/tools`, and only
      // `src/tools` was tracked.
      const created = mkdirSync(dirname(full), { recursive: true });
      if (created !== undefined) {
        madeDirectories.add(created);
      }
      writeFileSync(full, body, "utf8");
      written.push(relativePath);
    }

    // Written last, and rolled back together. Two documents that are supposed
    // to hold the same table must not be left holding different ones because
    // the second write failed — that pair is worse than no row at all, since
    // both are read and nothing says which is right.
    for (const table of tables) {
      const original = readFileSync(table.path, "utf8");
      writeFileSync(table.path, table.contents, "utf8");
      // Registered *after* the write, not before. Registering first meant the
      // undo for the document that had just failed was itself attempted — and
      // it failed the same way, which threw out of the catch below, aborted
      // the rest of the rollback and replaced the original error with the
      // error from trying to undo it.
      restore.push(() => writeFileSync(table.path, original, "utf8"));
    }
  } catch (error) {
    // Put the documents back first — they are shared state, and the service
    // directory is not. Each one independently: a rollback that stops at its
    // first failure leaves exactly the half-updated pair it exists to prevent.
    for (const undo of restore.reverse()) {
      try {
        undo();
      } catch {
        // Nothing useful to do, and the original error is what the caller
        // needs. Carry on with the rest.
      }
    }
    // Then remove what this run wrote. A half-written service left behind is
    // refused by the *next* run as a non-empty destination, so the failure
    // compounds into "delete this by hand before trying again".
    rollBackWrites(plan.destination, written, madeDirectories, destinationIsOurs);
    throw error;
  }

  return {
    files: written.sort(),
    entry: catalogueEntry(plan),
    portTablesUpdated: tables.map((table) => table.relativePath),
  };
}

/**
 * Undo the files this run created, and nothing else.
 *
 * Deliberately not `rm -rf destination`: the operator may have created that
 * directory themselves, and a scaffolder that deletes a directory it did not
 * make is a worse failure than the one it is recovering from. Only the paths
 * we wrote are removed, and the directory itself only when this run made it.
 */
function rollBackWrites(
  destination: string,
  written: string[],
  madeDirectories: Set<string>,
  destinationIsOurs: boolean,
): void {
  try {
    if (destinationIsOurs) {
      // This run created the destination, so the whole tree is ours.
      rmSync(destination, { recursive: true, force: true });
      return;
    }

    // The operator made the destination, so only what this run put inside it
    // may go: the files, and the directory subtrees that did not exist before.
    // Leaving the directories behind gave them back a *non-empty* directory,
    // which the next run refuses — the failure this rollback exists to
    // prevent, one level down.
    for (const relativePath of written) {
      rmSync(join(destination, relativePath), { force: true });
    }
    for (const dir of madeDirectories) {
      if (dir === destination) {
        continue;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // The original error is what the caller needs to see. A failure to clean
    // up is worth nothing next to it, and throwing here would replace the
    // cause with its consequence.
  }
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
  let anyFound = false;
  for (const relativePath of PORT_TABLE_DOCUMENTS) {
    const path = join(root, relativePath);
    if (!existsSync(path)) {
      continue;
    }
    anyFound = true;
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
  if (!anyFound) {
    // A fork may be missing one document. Missing *both* means this is not a
    // repository whose ports are tracked, and a service scaffolded into it
    // would claim its pair nowhere at all — the silent failure the table
    // exists to prevent.
    throw new Error(
      `No port table found in ${PORT_TABLE_DOCUMENTS.join(" or ")}. A workspace service has to claim its ports somewhere.`,
    );
  }

  return planned;
}

/**
 * Every port claimed anywhere in the repository.
 *
 * Both documents, not just `AGENTS.md`: they are the same table written twice
 * and are supposed to agree, but allocation must not *depend* on that. Reading
 * one and finding it missing used to return an empty list, which starts
 * allocation at 8001 and hands out a pair the other document already claims —
 * the collision this function exists to prevent, produced by the function
 * itself.
 */
export function claimedPorts(root: string): PortRow[] {
  const seen = new Map<string, PortRow>();
  for (const relativePath of PORT_TABLE_DOCUMENTS) {
    const path = join(root, relativePath);
    if (!existsSync(path)) {
      continue;
    }
    for (const row of parsePortTable(readFileSync(path, "utf8"))) {
      // Keyed by the whole pair, not by the service: the same row in both
      // documents counts once, and two documents that *disagree* about a
      // service's ports contribute both pairs. Keeping only the first would
      // hide the second from allocation and hand it to a new service.
      seen.set(`${row.service}:${row.http}:${row.mcp}`, row);
    }
  }
  return [...seen.values()];
}

export { portConflict };
