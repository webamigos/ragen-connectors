import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@clack/prompts";
import {
  TEMPLATED_AUTH_TYPES,
  parseArgs,
  type AuthType,
  type CliArgs,
} from "./args.js";
import { catalogueSummary, mcpEndpoint } from "./catalogue.js";
import { MCP_PORT_OFFSET, nextFreeHttpPort } from "./port-table.js";
import { catalogSlugError, slugify } from "./slug.js";
import {
  claimedPorts,
  portConflict,
  scaffold,
  type ScaffoldPlan,
} from "./scaffold.js";
import { directoryBlocker, findWorkspaceRoot, type Target } from "./workspace.js";

const DEFAULT_STANDALONE_PORT = 8080;
const DEFAULT_ICON = "plug";

export function cliVersion(): string {
  const manifest = fileURLToPath(new URL("../package.json", import.meta.url));
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string })
    .version;
}

/**
 * Returns false when the run was cancelled — the caller turns that into a
 * non-zero exit. A thrown error is a refusal with a reason and is printed by
 * the entrypoint.
 */
export async function run(argv: string[], cwd = process.cwd()): Promise<boolean> {
  const args = parseArgs(argv);
  const version = cliVersion();

  p.intro(`create-ragen-connector v${version}`);

  const workspace = findWorkspaceRoot(cwd);
  const target: Target =
    args.target ?? (workspace ? "workspace" : "standalone");

  if (target === "workspace" && !workspace) {
    throw new Error(
      "--target=workspace needs to run inside a ragen-connectors checkout (a package.json with `services/*` and `packages/*` workspaces). Run it there, or drop the flag for a standalone project.",
    );
  }

  const name = await ask(args, "name", () =>
    p.text({
      message: "What is this connector called?",
      placeholder: "Weather",
      validate: (value) =>
        value.trim().length === 0 ? "A name is required." : undefined,
    }),
  );
  if (name === null) {
    return cancelled();
  }

  const suggestedSlug = slugify(name);
  const slug = await ask(args, "slug", () =>
    p.text({
      message: "Catalogue slug",
      placeholder: suggestedSlug,
      initialValue: suggestedSlug,
      // The same rule ragen-app's /mcp-catalogue applies. Checking it now is
      // the difference between a typo and a service that is written, named,
      // built and then refused by the form.
      validate: (value) => catalogSlugError(value.trim()) ?? undefined,
    }),
  );
  if (slug === null) {
    return cancelled();
  }
  const slugProblem = catalogSlugError(slug.trim());
  if (slugProblem) {
    throw new Error(slugProblem);
  }

  const description = await ask(args, "description", () =>
    p.text({
      message: "One line describing it (the model reads this)",
      placeholder: "Current conditions and forecasts.",
      defaultValue: "",
    }),
  );
  if (description === null) {
    return cancelled();
  }

  const auth = (await ask(args, "auth", () =>
    p.select({
      message: "How does Ragen authenticate to it?",
      options: [
        {
          value: "server_side",
          label: "server_side",
          hint: "no per-customer credential; Ragen sends x-customer-id",
        },
        {
          value: "api_key_bearer",
          label: "api_key_bearer",
          hint: "the customer pastes their own key; Ragen sends it as a Bearer token",
        },
      ],
      initialValue: "server_side",
    }),
  )) as AuthType | null;
  if (auth === null) {
    return cancelled();
  }
  if (!(TEMPLATED_AUTH_TYPES as readonly string[]).includes(auth)) {
    throw new Error(`Unknown auth shape: ${auth}.`);
  }

  const claimed = workspace ? claimedPorts(workspace.root) : [];
  const suggestedPort = workspace
    ? nextFreeHttpPort(claimed)
    : DEFAULT_STANDALONE_PORT;

  const port = args.port ?? suggestedPort;
  const conflict = portConflict(claimed, port);
  if (conflict) {
    throw new Error(conflict);
  }

  const icon = args.icon ?? DEFAULT_ICON;

  const destination =
    target === "workspace"
      ? join(workspace!.root, "services", slug)
      : resolve(cwd, slug);

  const blocker = directoryBlocker(destination);
  if (blocker) {
    throw new Error(blocker);
  }

  const plan: ScaffoldPlan = {
    slug: slug.trim(),
    label: name.trim(),
    description: description.trim(),
    icon,
    auth,
    port,
    target,
    destination,
    workspaceRoot: target === "workspace" ? workspace!.root : null,
    cliVersion: version,
  };

  p.note(
    [
      `Target       ${target}`,
      `Directory    ${destination}`,
      `Ports        ${port} (HTTP) and ${port + MCP_PORT_OFFSET} (MCP)`,
      `Auth         ${auth}`,
    ].join("\n"),
    "About to write",
  );

  if (!args.yes) {
    const go = await p.confirm({ message: "Write it?" });
    if (p.isCancel(go) || !go) {
      return cancelled();
    }
  }

  const result = scaffold(plan);

  if (target === "standalone" && !args.skipGit) {
    initGit(destination);
  }

  p.log.success(`${result.files.length} files written.`);
  if (result.portTablesUpdated.length > 0) {
    p.log.info(
      `Port table updated in ${result.portTablesUpdated.join(" and ")}.`,
    );
  }

  p.note(catalogueSummary(result.entry), "Add this at /mcp-catalogue in apps/admin");

  p.outro(
    [
      nextSteps(target, plan),
      "",
      `The URL above is ${mcpEndpoint("localhost", port)} — replace the host with one Ragen can reach.`,
      "localhost is refused by the address policy even with \"allow a private address\" ticked; use your LAN address. The README says why.",
    ].join("\n"),
  );

  return true;
}

function nextSteps(target: Target, plan: ScaffoldPlan): string {
  const where =
    target === "workspace"
      ? `cd services/${plan.slug}`
      : `cd ${plan.slug}`;
  return [
    "Next:",
    `  ${where}`,
    "  cp .env.example .env.local",
    target === "workspace"
      ? "  npm install        # from the repository root"
      : "  npm install",
    "  npm run dev",
  ].join("\n");
}

/**
 * A flag's value, or the prompt's — and `null` when the user cancelled.
 *
 * `--yes` must never reach a prompt: a CI job that hits one hangs until
 * something kills it, which is the failure `--yes` exists to prevent.
 */
async function ask(
  args: CliArgs,
  key: "name" | "slug" | "description" | "auth",
  prompt: () => Promise<string | symbol>,
): Promise<string | null> {
  const given = args[key];
  if (given !== undefined) {
    return given;
  }
  if (args.yes) {
    if (key === "name") {
      throw new Error(
        "--yes needs a name: `create-ragen-connector <name> --yes`. Every other answer has a default.",
      );
    }
    return defaultFor(key, args);
  }
  const answer = await prompt();
  return p.isCancel(answer) ? null : String(answer);
}

function defaultFor(
  key: "slug" | "description" | "auth",
  args: CliArgs,
): string {
  if (key === "slug") {
    return slugify(args.name ?? "");
  }
  if (key === "description") {
    return "";
  }
  return "server_side";
}

function initGit(destination: string): void {
  try {
    execFileSync("git", ["init", "--quiet"], {
      cwd: destination,
      stdio: "ignore",
    });
  } catch {
    // No git, or a git that refused. The scaffold is written and usable, and
    // reporting a failure the user cannot act on here would read as though
    // the generation failed.
  }
}

function cancelled(): boolean {
  p.cancel("Nothing was written.");
  return false;
}
