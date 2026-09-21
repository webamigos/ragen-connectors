import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  insertPortRow,
  nextFreeHttpPort,
  parsePortTable,
  portConflict,
} from "../port-table.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const TABLE = `
| Service   | HTTP | MCP  |
| --------- | ---- | ---- |
| google    | 8001 | 9001 |
| clickup   | 8002 | 9002 |
| rejestrio | 8004 | 9004 |
`;

describe("parsePortTable", () => {
  it("reads the rows and skips the header and separator", () => {
    expect(parsePortTable(TABLE)).toEqual([
      { service: "google", http: 8001, mcp: 9001 },
      { service: "clickup", http: 8002, mcp: 9002 },
      { service: "rejestrio", http: 8004, mcp: 9004 },
    ]);
  });

  it("reads the real repository's table", () => {
    // The parser exists to survive the table growing. If this breaks, the
    // table's shape changed and allocation is about to hand out a used port.
    const rows = parsePortTable(
      readFileSync(`${REPO_ROOT}AGENTS.md`, "utf8"),
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.map((row) => row.service)).toContain("google");
    for (const row of rows) {
      expect(row.mcp).toBe(row.http + 1000);
    }
  });

  it("finds nothing in a document with no table", () => {
    expect(parsePortTable("# Nothing here\n\nProse.\n")).toEqual([]);
  });
});

describe("nextFreeHttpPort", () => {
  it("goes one past the highest, not into the gap", () => {
    // 8003 is free in TABLE, and it is free because a service was removed —
    // its ports may still be claimed in a compose or platform config this CLI
    // cannot see.
    expect(nextFreeHttpPort(parsePortTable(TABLE))).toBe(8005);
  });

  it("starts at the floor when the table is empty", () => {
    expect(nextFreeHttpPort([])).toBe(8001);
  });
});

describe("portConflict", () => {
  const rows = parsePortTable(TABLE);

  it("passes a free pair", () => {
    expect(portConflict(rows, 8005)).toBeNull();
  });

  it("catches a taken HTTP port", () => {
    expect(portConflict(rows, 8002)).toMatch(/clickup/);
  });

  it("catches an HTTP port that collides with somebody's MCP port", () => {
    // 8001's MCP sibling is 9001; asking for 9001 as an HTTP port would put
    // two listeners on it, and the second would fail at boot with nothing
    // explaining why.
    expect(portConflict(rows, 9001)).toMatch(/google/);
  });

  it("names the next free pair in the message", () => {
    expect(portConflict(rows, 8002)).toMatch(/8005\/9005/);
  });
});

describe("insertPortRow", () => {
  it("appends after the last row, keeping the column widths", () => {
    const result = insertPortRow(TABLE, {
      service: "weather",
      http: 8005,
      mcp: 9005,
    });
    expect(result).toContain("| weather   | 8005 | 9005 |");
    expect(parsePortTable(result)).toHaveLength(4);
  });

  it("throws when there is no table rather than writing the file unchanged", () => {
    // Silently succeeding is how a rename upstream turns into a service whose
    // ports nobody claimed — which passes its health check and has no tools.
    expect(() => insertPortRow("# Docs\n\nProse.\n", {
      service: "weather",
      http: 8005,
      mcp: 9005,
    })).toThrow(/No .* table found/);
  });

  it("does not absorb the row into a second table later in the document", () => {
    const twoTables = `${TABLE}\nSome prose.\n\n| Env | 1000 | 2000 |\n`;
    const result = insertPortRow(twoTables, {
      service: "weather",
      http: 8005,
      mcp: 9005,
    });
    const lines = result.split("\n");
    const inserted = lines.findIndex((line) => line.includes("weather"));
    const secondTable = lines.findIndex((line) => line.includes("| Env |"));
    expect(inserted).toBeLessThan(secondTable);
  });
});
