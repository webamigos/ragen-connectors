import { CATALOGUE_AUTH_TYPE, type AuthType } from "./args.js";
import { MCP_PORT_OFFSET } from "./port-table.js";

/**
 * The values a platform administrator types into Ragen's `/mcp-catalogue`, as
 * a file beside the service and as a printed summary.
 *
 * Emitted rather than written: ragen-app has no authenticated API for
 * catalogue entries, and going around the form would bypass its validation,
 * its audit entry and its address check — three things that were put there on
 * purpose. The `$schema` key is here from the first release so a future
 * `--register` has something to send.
 */

export interface CatalogueEntry {
  $schema: string;
  slug: string;
  label: string;
  description: string;
  lucideIcon: string;
  authType: string;
  scopes: string[];
  mcpServerUrl: string;
  generatedBy: string;
}

export const CATALOGUE_SCHEMA_URL =
  "https://docs.ragen.ai/schemas/ragen-connector-v1.json";

export function catalogueEntry(options: {
  slug: string;
  label: string;
  description: string;
  icon: string;
  auth: AuthType;
  port: number;
  cliVersion: string;
}): CatalogueEntry {
  return {
    $schema: CATALOGUE_SCHEMA_URL,
    slug: options.slug,
    label: options.label,
    description: options.description,
    lucideIcon: options.icon,
    authType: CATALOGUE_AUTH_TYPE[options.auth],
    // Scopes belong to an OAuth authorization request, and the form refuses
    // them on every other shape. Neither templated shape is OAuth.
    scopes: [],
    mcpServerUrl: mcpEndpoint("localhost", options.port),
    generatedBy: `create-ragen-connector@${options.cliVersion}`,
  };
}

/**
 * The MCP endpoint, with the `/mcp` suffix that makes the difference between
 * a connector that loads tools and one that does not.
 *
 * Ragen stores the connector with `/mcp` appended and dials the catalogue
 * row's URL verbatim, so a row without the suffix names a different address
 * than the connector it created. Test connection catches it; emitting the
 * right string means nobody has to be caught.
 */
export function mcpEndpoint(host: string, httpPort: number): string {
  return `http://${host}:${httpPort + MCP_PORT_OFFSET}/mcp`;
}

/** What the CLI prints when it is done. */
export function catalogueSummary(entry: CatalogueEntry): string {
  const rows: [string, string][] = [
    ["Slug", entry.slug],
    ["Name", entry.label],
    ["Authentication", entry.authType],
    ["Server URL", entry.mcpServerUrl],
    ["Icon", entry.lucideIcon],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(([label, value]) => `  ${label.padEnd(width)}  ${value}`)
    .join("\n");
}
