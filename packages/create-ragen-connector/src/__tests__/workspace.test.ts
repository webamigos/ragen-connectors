import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { directoryBlocker, findWorkspaceRoot } from "../workspace.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

describe("findWorkspaceRoot", () => {
  it("finds the real repository from inside a package", () => {
    const found = findWorkspaceRoot(
      fileURLToPath(new URL("../", import.meta.url)),
    );
    expect(found?.root).toBe(REPO_ROOT.replace(/\/$/, ""));
  });

  it("returns null outside one", () => {
    expect(findWorkspaceRoot(mkdtempSync(join(tmpdir(), "crc-")))).toBeNull();
  });

  it("identifies the root by its workspace globs, not by its name", () => {
    // A fork renames the package; `services/*` beside `packages/*` is the
    // shape this CLI writes into.
    const root = mkdtempSync(join(tmpdir(), "crc-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "anything", workspaces: ["packages/*", "services/*"] }),
    );
    expect(findWorkspaceRoot(root)?.root).toBe(root);
  });

  it("ignores a package.json with only one of the two globs", () => {
    const root = mkdtempSync(join(tmpdir(), "crc-"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "other-monorepo", workspaces: ["packages/*"] }),
    );
    expect(findWorkspaceRoot(root)).toBeNull();
  });

  it("walks past a malformed package.json rather than failing the run", () => {
    const root = mkdtempSync(join(tmpdir(), "crc-"));
    writeFileSync(join(root, "package.json"), "{ not json");
    expect(() => findWorkspaceRoot(root)).not.toThrow();
  });
});

describe("directoryBlocker", () => {
  it("allows a path that does not exist", () => {
    expect(directoryBlocker(join(tmpdir(), "crc-nothing-here"))).toBeNull();
  });

  it("allows an empty directory", () => {
    expect(directoryBlocker(mkdtempSync(join(tmpdir(), "crc-")))).toBeNull();
  });

  it("refuses a directory with files in it", () => {
    // A standalone target has no git yet, so a half-scaffold over someone's
    // project cannot be undone.
    const dir = mkdtempSync(join(tmpdir(), "crc-"));
    mkdirSync(join(dir, "src"));
    expect(directoryBlocker(dir)).toMatch(/not empty/);
  });

  it("does not count .DS_Store as content", () => {
    const dir = mkdtempSync(join(tmpdir(), "crc-"));
    writeFileSync(join(dir, ".DS_Store"), "");
    expect(directoryBlocker(dir)).toBeNull();
  });
});
