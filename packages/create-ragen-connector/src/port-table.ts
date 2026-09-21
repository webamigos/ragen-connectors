/**
 * The port table, as data.
 *
 * A service is two listeners — Hono on `PORT`, FastMCP on `PORT + 1000` — and
 * the pair is claimed in six places (ADR-01, and the `connectors-add-service`
 * skill's list). A service whose MCP port nobody claimed passes its health
 * check and is unusable, and at the client that reads as "no tools", which
 * looks like a client bug: `docs/lessons/fastmcp-owns-its-own-listener.md`.
 *
 * Parsing the table rather than hard-coding "the next one is 8005" is what
 * makes the allocation still correct after the fifth service lands.
 */

export interface PortRow {
  service: string;
  http: number;
  mcp: number;
}

/** The MCP listener's offset from the HTTP one (ADR-01). */
export const MCP_PORT_OFFSET = 1000;

const ROW = /^\|\s*([A-Za-z0-9._-]+)\s*\|\s*(\d{2,5})\s*\|\s*(\d{2,5})\s*\|\s*$/;

/**
 * Every `| service | http | mcp |` row in a Markdown document.
 *
 * Header and separator rows fail the numeric groups, so they need no special
 * case. A document with no table yields an empty list, which the caller has to
 * treat as a failure rather than as "start at the beginning" — see
 * `insertPortRow`.
 */
export function parsePortTable(markdown: string): PortRow[] {
  const rows: PortRow[] = [];
  for (const line of markdown.split("\n")) {
    const match = ROW.exec(line);
    if (!match) {
      continue;
    }
    rows.push({
      service: match[1],
      http: Number(match[2]),
      mcp: Number(match[3]),
    });
  }
  return rows;
}

/**
 * The next free HTTP port: one past the highest claimed, never reusing a gap.
 *
 * A gap in the table is a service that was deleted, and its ports may still be
 * claimed in a Railway config or a compose file this CLI cannot see. Reusing
 * one would produce a collision whose cause is in a repository the author is
 * not looking at.
 */
export function nextFreeHttpPort(rows: PortRow[], floor = 8001): number {
  const highest = rows.reduce((max, row) => Math.max(max, row.http), 0);
  return Math.max(highest + 1, floor);
}

/**
 * Whether the table already lists this service.
 *
 * The directory check catches the ordinary case — you cannot scaffold over an
 * existing `services/<slug>`. A row and a directory can still diverge: delete
 * the directory to regenerate a service and the row stays, and the next run
 * appends a *second* row for the same name on a different port. A table with
 * two rows for one service is worse than one with none, by the same argument
 * that makes the pair of documents worth keeping in step — both are read, and
 * nothing says which is right.
 */
export function serviceConflict(
  rows: PortRow[],
  service: string,
): string | null {
  const existing = rows.find((row) => row.service === service);
  if (!existing) {
    return null;
  }
  return `The port table already lists \`${service}\` on ${existing.http}/${existing.mcp}. Remove that row first, or pick another slug — a second row for the same service is a table nobody can trust.`;
}

export function portConflict(rows: PortRow[], http: number): string | null {
  const mcp = http + MCP_PORT_OFFSET;
  const taken = rows.find((row) => row.http === http || row.mcp === http || row.mcp === mcp || row.http === mcp);
  if (!taken) {
    return null;
  }
  return `Port ${http} (and ${mcp} for MCP) overlaps ${taken.service}, which holds ${taken.http}/${taken.mcp}. The next free pair is ${nextFreeHttpPort(rows)}/${nextFreeHttpPort(rows) + MCP_PORT_OFFSET}.`;
}

/**
 * Append a row to the first port table in the document, matching the column
 * widths already there.
 *
 * Throws when there is no table. Silently writing the file unchanged is how a
 * rename upstream turns into a service with unclaimed ports, which is the
 * failure at the top of this file.
 */
export function insertPortRow(markdown: string, row: PortRow): string {
  const lines = markdown.split("\n");
  const rowIndexes = lines
    .map((line, index) => (ROW.test(line) ? index : -1))
    .filter((index) => index !== -1);

  if (rowIndexes.length === 0) {
    throw new Error(
      "No `| service | http | mcp |` table found. The port table has moved or changed shape; claim the ports by hand and fix this CLI.",
    );
  }

  // The first contiguous run of rows is the first table. A later table in the
  // same document (architecture.md has prose between several) must not absorb
  // the row.
  let last = rowIndexes[0];
  for (const index of rowIndexes.slice(1)) {
    if (index !== last + 1) {
      break;
    }
    last = index;
  }

  const widths = columnWidths(lines[last]);
  lines.splice(last + 1, 0, formatRow(row, widths));
  return lines.join("\n");
}

function columnWidths(line: string): [number, number, number] {
  const cells = line.split("|").slice(1, 4);
  return [
    cells[0]?.length ?? 11,
    cells[1]?.length ?? 6,
    cells[2]?.length ?? 6,
  ];
}

function formatRow(row: PortRow, widths: [number, number, number]): string {
  const cell = (value: string, width: number): string =>
    ` ${value} `.padEnd(width, " ");
  return `|${cell(row.service, widths[0])}|${cell(String(row.http), widths[1])}|${cell(String(row.mcp), widths[2])}|`;
}
