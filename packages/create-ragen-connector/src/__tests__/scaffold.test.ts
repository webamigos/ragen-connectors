import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePortTable } from "../port-table.js";
import { PORT_TABLE_DOCUMENTS, planFiles, scaffold, type ScaffoldPlan } from "../scaffold.js";

function plan(overrides: Partial<ScaffoldPlan> = {}): ScaffoldPlan {
  const destination = join(mkdtempSync(join(tmpdir(), "crc-")), "weather");
  return {
    slug: "weather",
    label: "Weather",
    description: "Current conditions.",
    icon: "cloud-sun",
    auth: "server_side",
    port: 8005,
    target: "workspace",
    destination,
    workspaceRoot: null,
    cliVersion: "0.1.0",
    ...overrides,
  };
}

/** A repository with the two port-table documents and nothing else. */
function fakeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "crc-repo-"));
  writeFileSync(
    join(root, "AGENTS.md"),
    "# A\n\n| Service | HTTP | MCP  |\n| ------- | ---- | ---- |\n| google  | 8001 | 9001 |\n",
  );
  mkdirSync(join(root, "docs"));
  writeFileSync(
    join(root, "docs", "architecture.md"),
    "# B\n\n| Service | HTTP | MCP  |\n| ------- | ---- | ---- |\n| google  | 8001 | 9001 |\n",
  );
  return root;
}

describe("planFiles", () => {
  it("adds the catalogue file to the rendered set", () => {
    const entry = JSON.parse(planFiles(plan()).get("ragen-connector.json")!);
    expect(entry).toMatchObject({
      slug: "weather",
      label: "Weather",
      authType: "SERVER_SIDE",
      lucideIcon: "cloud-sun",
      // With the suffix: a row without it names a different address than the
      // connector Ragen creates from it.
      mcpServerUrl: "http://localhost:9005/mcp",
      generatedBy: "create-ragen-connector@0.1.0",
    });
    expect(entry.$schema).toMatch(/ragen-connector-v1/);
  });

  it("carries no scopes, because neither templated shape is OAuth", () => {
    const entry = JSON.parse(planFiles(plan()).get("ragen-connector.json")!);
    expect(entry.scopes).toEqual([]);
  });
});

describe("scaffold", () => {
  it("writes every planned file and nothing else", () => {
    const p = plan();
    const result = scaffold(p);
    expect(result.files).toContain("src/index.ts");
    expect(result.files).toContain("ragen-connector.json");
    for (const file of result.files) {
      expect(existsSync(join(p.destination, file))).toBe(true);
    }
  });

  it("substitutes the port into the files that carry it", () => {
    const p = plan({ port: 8007 });
    scaffold(p);
    expect(readFileSync(join(p.destination, ".env.example"), "utf8")).toContain(
      "PORT=8007",
    );
    expect(
      readFileSync(join(p.destination, "docker-compose.yml"), "utf8"),
    ).toContain('"9007:9007"');
  });

  it("updates both port tables for a workspace target", () => {
    // One document updated and the other not is worse than neither: the stale
    // one is as likely to be read.
    const root = fakeWorkspace();
    const p = plan({ workspaceRoot: root, port: 8005 });
    const result = scaffold(p);

    expect(result.portTablesUpdated).toEqual(PORT_TABLE_DOCUMENTS);
    for (const document of PORT_TABLE_DOCUMENTS) {
      const rows = parsePortTable(readFileSync(join(root, document), "utf8"));
      expect(rows).toContainEqual({ service: "weather", http: 8005, mcp: 9005 });
    }
  });

  it("touches no port table for a standalone target", () => {
    expect(scaffold(plan({ target: "standalone" })).portTablesUpdated).toEqual([]);
  });
});

describe("when a port table cannot be updated", () => {
  it("writes nothing at all, rather than a service with one table updated", () => {
    // The half-scaffold is the one state nobody can recover from: the next run
    // refuses the directory as non-empty, and a standalone target has no git.
    const root = fakeWorkspace();
    writeFileSync(join(root, "docs", "architecture.md"), "# Moved\n\nNo table.\n");

    const p = plan({ workspaceRoot: root, port: 8005 });

    expect(() => scaffold(p)).toThrow(/table found/);
    expect(
      existsSync(p.destination),
      "the service directory should not exist after a refused run",
    ).toBe(false);

    // And the table that *could* be updated was left alone, so the pair still
    // agrees with itself.
    expect(parsePortTable(readFileSync(join(root, "AGENTS.md"), "utf8"))).toEqual([
      { service: "google", http: 8001, mcp: 9001 },
    ]);
  });

  it("tolerates a document a fork simply does not carry", () => {
    const root = fakeWorkspace();
    rmSync(join(root, "docs", "architecture.md"));

    const result = scaffold(plan({ workspaceRoot: root, port: 8005 }));

    expect(result.portTablesUpdated).toEqual(["AGENTS.md"]);
  });
});

describe("the generated service", () => {
  it("is a tree the repository's own tools can read", () => {
    // Not a substitute for the integration check that compiles it — this only
    // asserts the shape is a service and not a bag of files.
    const p = plan();
    scaffold(p);
    const manifest = JSON.parse(
      readFileSync(join(p.destination, "package.json"), "utf8"),
    );
    expect(manifest.name).toBe("@ragen-connectors/weather");
    expect(manifest.scripts.dev).toContain("tsx watch");
    expect(manifest.type).toBe("module");
  });

  it("imports local modules with .js extensions, as ESM requires", () => {
    const p = plan();
    scaffold(p);
    const index = readFileSync(join(p.destination, "src/index.ts"), "utf8");
    for (const match of index.matchAll(/from "(\.[^"]+)"/g)) {
      expect(match[1]).toMatch(/\.js$/);
    }
  });

  it("imports the OTEL seam above every other import", () => {
    // OTEL patches modules at import time; anything imported above it is
    // never instrumented.
    const p = plan();
    scaffold(p);
    const lines = readFileSync(join(p.destination, "src/index.ts"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("import "));
    expect(lines[0]).toContain("runtime/instrument.js");
  });

  it("sets OTEL_SERVICE_NAME in the environment rather than in the entrypoint", () => {
    // An ESM `process.env.X ??=` in index.ts runs after the imports it is
    // trying to configure, so it silently never applies.
    const p = plan();
    scaffold(p);
    expect(readFileSync(join(p.destination, "src/index.ts"), "utf8")).not.toMatch(
      /process\.env\.OTEL_SERVICE_NAME\s*\?\?=/,
    );
    expect(readFileSync(join(p.destination, ".env.example"), "utf8")).toContain(
      "OTEL_SERVICE_NAME=ragen-mcp-weather",
    );
  });
});
