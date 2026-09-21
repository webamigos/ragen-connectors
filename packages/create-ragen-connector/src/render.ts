import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthType } from "./args.js";
import { CATALOGUE_AUTH_TYPE } from "./args.js";
import { MCP_PORT_OFFSET } from "./port-table.js";
import type { Target } from "./workspace.js";

/**
 * Rendering is three layers merged in order — `common`, then the auth shape,
 * then the target — with later layers overwriting the same relative path.
 *
 * The layering is what keeps the two targets from drifting: everything that is
 * not genuinely target-specific can only be written once, in `common`, and
 * `templates-differ-only-where-they-must.test.ts` asserts the target layer
 * stays down to the two files it is allowed to hold. Two whole templates side
 * by side would drift, and the drift would be invisible until someone's
 * standalone connector encoded a contract that changed a release ago.
 */

export interface RenderOptions {
  slug: string;
  label: string;
  description: string;
  port: number;
  auth: AuthType;
  icon: string;
  target: Target;
  cliVersion: string;
}

export type RenderedFiles = Map<string, string>;

/** `.tmpl` keeps template sources out of tsc, eslint and vitest globs. */
const TEMPLATE_SUFFIX = ".tmpl";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

export function templateLayers(options: RenderOptions): string[] {
  return [
    join(TEMPLATES_DIR, "common"),
    join(TEMPLATES_DIR, "auth", options.auth),
    join(TEMPLATES_DIR, options.target),
  ];
}

export function render(options: RenderOptions): RenderedFiles {
  const files: RenderedFiles = new Map();
  for (const layer of templateLayers(options)) {
    for (const [path, body] of readLayer(layer)) {
      files.set(path, substitute(body, options));
    }
  }
  return files;
}

/**
 * One layer's files, keyed by the path they will be written to — which is the
 * template's path with `.tmpl` removed.
 *
 * A missing layer is empty rather than an error: an auth shape with nothing to
 * add is a legitimate state, and turning it into a crash would make adding one
 * a two-file change for no reason.
 */
export function readLayer(dir: string): RenderedFiles {
  const files: RenderedFiles = new Map();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      for (const [nested, body] of readLayer(full)) {
        files.set(join(entry, nested), body);
      }
      continue;
    }
    if (!entry.endsWith(TEMPLATE_SUFFIX)) {
      continue;
    }
    files.set(entry.slice(0, -TEMPLATE_SUFFIX.length), readFileSync(full, "utf8"));
  }
  return files;
}

/**
 * The substitutions, as a table so a test can assert none is left behind.
 *
 * `__`-delimited rather than `${}` or `{{}}`: the templates are TypeScript,
 * JSON and YAML that must stay readable, and every other delimiter collides
 * with something one of the three does.
 */
export function substitutions(options: RenderOptions): Record<string, string> {
  return {
    __SLUG__: options.slug,
    __LABEL__: options.label,
    __LABEL_IDENT__: identifierFor(options.slug),
    __DESCRIPTION__: options.description,
    __PORT__: String(options.port),
    __MCP_PORT__: String(options.port + MCP_PORT_OFFSET),
    __OTEL_SERVICE_NAME__: `ragen-mcp-${options.slug}`,
    __CATALOGUE_AUTH_TYPE__: CATALOGUE_AUTH_TYPE[options.auth],
    __AUTH_TYPE__: options.auth,
    __ICON__: options.icon,
    __CLI_VERSION__: options.cliVersion,
  };
}

export function substitute(body: string, options: RenderOptions): string {
  let result = body;
  for (const [token, value] of Object.entries(substitutions(options))) {
    result = result.split(token).join(value);
  }
  return result;
}

/** Every `__TOKEN__` left in rendered output — a template referring to a token nobody defines. */
export function unresolvedTokens(files: RenderedFiles): string[] {
  const found = new Set<string>();
  for (const body of files.values()) {
    for (const match of body.matchAll(/__[A-Z][A-Z0-9_]*__/g)) {
      found.add(match[0]);
    }
  }
  return [...found].sort();
}

/**
 * The slug as a JavaScript identifier fragment, for `register<X>Tools`.
 *
 * Built from the slug rather than the label because the label is free text:
 * `Rejestr.io (KRS)` is a perfectly good name and not a perfectly good
 * identifier, and a template that produced `registerRejestr.io(KRS)Tools`
 * would fail to parse rather than fail to read well.
 */
export function identifierFor(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** Paths as they read in a message, whatever the platform's separator is. */
export function displayPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}
