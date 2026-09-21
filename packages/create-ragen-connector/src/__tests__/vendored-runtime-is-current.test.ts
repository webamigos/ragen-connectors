import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The standalone target vendors what the workspace target imports, and a
 * vendored copy does not get fixes. This is the tripwire.
 *
 * Two of the four files are byte-identical copies and are asserted as such.
 * The third, `logger.ts`, deliberately is not — core's forwards every record
 * to an OTLP collector through a pino hook, which would pull a dozen OTEL
 * packages into a standalone connector to reach a collector that does not
 * exist. For that one the assertion is the export surface, because that is
 * what the shared files call.
 */

const CORE = fileURLToPath(
  new URL("../../../core/src/", import.meta.url),
);
const VENDORED = fileURLToPath(
  new URL("../../templates/standalone/src/runtime/", import.meta.url),
);

const BYTE_IDENTICAL = ["env.ts", "customer.ts"];

describe("the vendored runtime", () => {
  it.each(BYTE_IDENTICAL)("%s is core's file, unchanged", (file) => {
    expect(readFileSync(`${VENDORED}${file}.tmpl`, "utf8")).toBe(
      readFileSync(`${CORE}${file}`, "utf8"),
    );
  });

  it("exports the same four helpers the workspace seam does", () => {
    const workspace = readFileSync(
      fileURLToPath(
        new URL("../../templates/workspace/src/runtime/index.ts.tmpl", import.meta.url),
      ),
      "utf8",
    );
    const standalone = readFileSync(`${VENDORED}index.ts.tmpl`, "utf8");

    for (const exported of [
      "validateEnvVars",
      "validateEnv",
      "logger",
      "getCustomerId",
    ]) {
      expect(workspace).toContain(exported);
      expect(standalone).toContain(exported);
    }
  });

  it("says where it came from, in the file somebody will read first", () => {
    expect(readFileSync(`${VENDORED}index.ts.tmpl`, "utf8")).toMatch(
      /Vendored from @ragen-connectors\/core/,
    );
  });

  it("explains why logger.ts is not a copy", () => {
    // Without the header, the next person to run this test's failure will
    // "fix" it by copying core's logger and pulling OTEL into every
    // standalone install.
    expect(readFileSync(`${VENDORED}logger.ts.tmpl`, "utf8")).toMatch(
      /not.*a copy|OpenTelemetry/s,
    );
  });
});
