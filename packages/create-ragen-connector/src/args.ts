import { catalogSlugError } from "./slug.js";

/**
 * The shapes of authentication this CLI can template.
 *
 * ragen-app offers a platform administrator three (`OPERATOR_CREATABLE_AUTH_TYPES`);
 * this generates two of them. `external_mcp` is refused rather than generated:
 * FastMCP 3 can serve the OAuth discovery endpoints `@ai-sdk/mcp`'s `auth()`
 * looks for, but a generated authorization server that nobody can run without
 * their own provider and client credentials is a checklist in disguise — which
 * is the thing this CLI exists to replace. `parseArgs` says so by name.
 */
export const TEMPLATED_AUTH_TYPES = ["server_side", "api_key_bearer"] as const;

export type AuthType = (typeof TEMPLATED_AUTH_TYPES)[number];

/** What the catalogue row's `authType` column holds for each. */
export const CATALOGUE_AUTH_TYPE: Record<AuthType, string> = {
  server_side: "SERVER_SIDE",
  api_key_bearer: "API_KEY_BEARER",
};

export interface CliArgs {
  /** Undefined when no positional argument was given — the CLI prompts. */
  name: string | undefined;
  slug: string | undefined;
  description: string | undefined;
  auth: AuthType | undefined;
  /** The Hono port. The MCP port is always this plus 1000 (ADR-01). */
  port: number | undefined;
  icon: string | undefined;
  /** Force a target instead of deciding from the working directory. */
  target: "workspace" | "standalone" | undefined;
  skipInstall: boolean;
  skipGit: boolean;
  yes: boolean;
}

const TARGETS = ["workspace", "standalone"] as const;

export function parseArgs(argv: string[]): CliArgs {
  const positionals = argv.filter((arg) => !arg.startsWith("--"));
  if (positionals.length > 1) {
    // Every flag takes `--name=value`, not a separate token — a second bare
    // token (`--port 9005`) would otherwise silently become the name.
    throw new Error(
      `Unexpected extra arguments: ${positionals.slice(1).join(" ")}. Flag values must use --name=value.`,
    );
  }

  const hasFlag = (name: string): boolean => argv.includes(`--${name}`);
  const valueOf = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const value = argv
      .find((arg) => arg.startsWith(prefix))
      ?.slice(prefix.length);
    return value || undefined;
  };

  const auth = valueOf("auth");
  if (auth && !(TEMPLATED_AUTH_TYPES as readonly string[]).includes(auth)) {
    // Rejected rather than ignored: falling back to "ask me" turns a typo in a
    // CI job into a hang on a prompt nothing can answer.
    throw new Error(
      auth === "external_mcp"
        ? "`external_mcp` is not templated. It needs an authorization server and client credentials this CLI cannot generate; see the README for wiring FastMCP's `oauth` option by hand."
        : `Unknown --auth=${auth}. Expected one of: ${TEMPLATED_AUTH_TYPES.join(", ")}.`,
    );
  }

  const target = valueOf("target");
  if (target && !(TARGETS as readonly string[]).includes(target)) {
    throw new Error(
      `Unknown --target=${target}. Expected one of: ${TARGETS.join(", ")}.`,
    );
  }

  const slug = valueOf("slug");
  if (slug) {
    const problem = catalogSlugError(slug);
    if (problem) {
      throw new Error(`--slug=${slug} is not usable: ${problem}`);
    }
  }

  const rawPort = valueOf("port");
  let port: number | undefined;
  if (rawPort !== undefined) {
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1024 || port > 64535) {
      // The ceiling is 64535 and not 65535 because the MCP listener is
      // PORT + 1000 (ADR-01) and has to fit too.
      throw new Error(
        `--port=${rawPort} is not a usable port. Give a whole number between 1024 and 64535 — the MCP listener takes port + 1000.`,
      );
    }
  }

  return {
    name: positionals[0],
    slug,
    description: valueOf("description"),
    auth: auth as AuthType | undefined,
    port,
    icon: valueOf("icon"),
    target: target as "workspace" | "standalone" | undefined,
    skipInstall: hasFlag("skip-install"),
    skipGit: hasFlag("skip-git"),
    yes: hasFlag("yes"),
  };
}
