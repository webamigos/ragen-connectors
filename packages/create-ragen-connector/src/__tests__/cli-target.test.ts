import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../cli.js";

/**
 * A directory that `findWorkspaceRoot` accepts: the two workspace globs, and a
 * port table whose rows deliberately include the standalone default pair.
 *
 * The overlap is the point. A standalone project has nothing to do with this
 * repository's ports, so 8080 must be free for it — while the same number is
 * legitimately taken by a service *in* the table.
 */
function fakeCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), "crc-checkout-"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fake", workspaces: ["packages/*", "services/*"] }),
  );
  writeFileSync(
    join(root, "AGENTS.md"),
    "# A\n\n| Service | HTTP | MCP  |\n| ------- | ---- | ---- |\n| google  | 8001 | 9001 |\n| legacy  | 8080 | 9080 |\n",
  );
  mkdirSync(join(root, "docs"));
  writeFileSync(
    join(root, "docs", "architecture.md"),
    "# B\n\n| Service | HTTP | MCP  |\n| ------- | ---- | ---- |\n| google  | 8001 | 9001 |\n| legacy  | 8080 | 9080 |\n",
  );
  return root;
}

/**
 * `--target=standalone` run from *inside* a checkout.
 *
 * `findWorkspaceRoot` still finds it, and the port allocation used to key on
 * that rather than on the target — so a standalone project took its port from
 * the monorepo's table, and here would be refused outright because a service
 * in a repository it has nothing to do with already holds 8080.
 */
describe("the target decides the ports, not the directory", () => {
  it("uses the standalone default even where the table claims it", async () => {
    const root = fakeCheckout();

    const completed = await run(
      ["Acme", "--slug=acme", "--target=standalone", "--skip-git", "--yes"],
      root,
    );

    expect(completed).toBe(true);
    const manifest = join(root, "acme", "ragen-connector.json");
    expect(existsSync(manifest)).toBe(true);
    expect(JSON.parse(readFileSync(manifest, "utf8")).mcpServerUrl).toBe(
      "http://localhost:9080/mcp",
    );
  });

  it("leaves the checkout's port tables alone for a standalone target", async () => {
    const root = fakeCheckout();
    const before = readFileSync(join(root, "AGENTS.md"), "utf8");

    await run(
      ["Acme", "--slug=acme", "--target=standalone", "--skip-git", "--yes"],
      root,
    );

    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(before);
  });

  it("still allocates from the table, and claims it, for a workspace target", async () => {
    // The other half of the rule, so a fix that just ignored the workspace
    // everywhere would fail here.
    const root = fakeCheckout();

    await run(["Acme", "--slug=acme", "--yes"], root);

    const manifest = join(root, "services", "acme", "ragen-connector.json");
    expect(existsSync(manifest)).toBe(true);
    // One past the highest in the table (8080), not the standalone default.
    expect(JSON.parse(readFileSync(manifest, "utf8")).mcpServerUrl).toBe(
      "http://localhost:9081/mcp",
    );
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("| acme");
  });
});
