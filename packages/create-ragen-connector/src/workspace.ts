import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Which of the two shapes to generate, decided from where the CLI was run.
 *
 * This is a real fork, not a preference. An internal connector *must* join the
 * `ragen-connectors` workspace — turbo reads the build graph from
 * `package.json`, one root `npm test` covers every service, and the port table
 * only means anything if every service is in it. An external one must not
 * require a checkout of a repository its author has no reason to clone.
 */
export type Target = "workspace" | "standalone";

export interface WorkspaceRoot {
  /** Absolute path to the ragen-connectors checkout. */
  root: string;
}

/**
 * The `ragen-connectors` root at or above `from`, or null.
 *
 * Identified by its `workspaces` globs rather than by name: a fork renames the
 * package, and `services/*` beside `packages/*` is the shape this CLI writes
 * into.
 */
export function findWorkspaceRoot(from: string): WorkspaceRoot | null {
  let current = resolve(from);
  for (;;) {
    const manifest = join(current, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
          workspaces?: string[];
        };
        const globs = parsed.workspaces ?? [];
        if (globs.includes("services/*") && globs.includes("packages/*")) {
          return { root: current };
        }
      } catch {
        // An unreadable or malformed package.json is not this CLI's business;
        // keep walking up rather than failing the whole run on someone else's
        // broken file.
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Whether a directory can be written into.
 *
 * Refusing a non-empty directory is the one irreversible thing this CLI could
 * otherwise do: a standalone target has no git yet, so a half-scaffold over
 * someone's project cannot be undone.
 */
export function directoryBlocker(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  const entries = readdirSync(path).filter((entry) => entry !== ".DS_Store");
  if (entries.length === 0) {
    return null;
  }
  return `${path} already exists and is not empty (${entries.length} entries). Pick another name, or empty it first.`;
}
