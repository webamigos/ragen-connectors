import { describe, expect, it } from "vitest";
import { TEMPLATED_AUTH_TYPES } from "../args.js";
import {
  identifierFor,
  render,
  substitute,
  unresolvedTokens,
  type RenderOptions,
} from "../render.js";
import { planFiles } from "../scaffold.js";

/** `ragen-connector.json` as the scaffold plan produces it. */
function planFilesFor(o: RenderOptions): string {
  return planFiles({
    ...o,
    destination: "/tmp/unused",
    workspaceRoot: null,
  }).get("ragen-connector.json")!;
}

function options(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    slug: "weather",
    label: "Weather",
    description: "Current conditions.",
    port: 8005,
    auth: "server_side",
    icon: "cloud-sun",
    target: "workspace",
    cliVersion: "0.1.0",
    ...overrides,
  };
}

const EVERY_COMBINATION = TEMPLATED_AUTH_TYPES.flatMap((auth) =>
  (["workspace", "standalone"] as const).map((target) =>
    options({ auth, target }),
  ),
);

describe("render", () => {
  it.each(EVERY_COMBINATION)(
    "leaves no token unresolved for $auth/$target",
    (combination) => {
      // A token nothing defines renders as itself, and a generated file
      // holding `__LABEL_IDENT__` fails to compile with a message pointing at
      // the author's code instead of at this CLI.
      expect(unresolvedTokens(render(combination))).toEqual([]);
    },
  );

  it.each(EVERY_COMBINATION)(
    "writes the files a service needs for $auth/$target",
    (combination) => {
      const paths = [...render(combination).keys()];
      for (const required of [
        "package.json",
        "tsconfig.json",
        "tsconfig.build.json",
        "Dockerfile",
        "docker-compose.yml",
        "README.md",
        ".env.example",
        "src/index.ts",
        "src/auth.ts",
        "src/headers.ts",
        "src/runtime/index.ts",
        "src/runtime/instrument.ts",
        "src/tools/example-tools.ts",
        "src/services/example-api.ts",
        "src/__tests__/example-tools.test.ts",
        "src/__tests__/session.ts",
        "src/__tests__/auth.test.ts",
      ]) {
        expect(paths).toContain(required);
      }
    },
  );

  it("puts both ports in the compose file, not just the HTTP one", () => {
    // Publishing only PORT leaves a container that is healthy and has no
    // tools, which reads at the client as a client bug.
    const compose = render(options()).get("docker-compose.yml")!;
    expect(compose).toContain('"8005:8005"');
    expect(compose).toContain('"9005:9005"');
  });

  it("gives the workspace Dockerfile the monorepo build context and the standalone one its own", () => {
    expect(render(options()).get("docker-compose.yml")).toContain("context: ../..");
    expect(
      render(options({ target: "standalone" })).get("docker-compose.yml"),
    ).toContain("context: .");
  });

  it("depends on core in the workspace and vendors it standalone", () => {
    expect(render(options()).get("package.json")).toContain(
      "@ragen-connectors/core",
    );
    const standalone = render(options({ target: "standalone" }));
    expect(standalone.get("package.json")).not.toContain("@ragen-connectors/core");
    expect(standalone.get("src/runtime/env.ts")).toBeDefined();
    expect(standalone.get("src/runtime/customer.ts")).toBeDefined();
    expect(standalone.get("src/runtime/logger.ts")).toBeDefined();
  });

  it("never vendors the vault client", () => {
    // Core carries RagenVaultClient, an HMAC-signed contract with an internal
    // Ragen service. A connector outside that deployment has no secret for it
    // and no business holding it.
    // Matched against imports, exports and assignments rather than the whole
    // text: the standalone runtime's header explains in prose why the vault
    // client is not there, and a test that could not tell the explanation
    // from the thing would forbid saying so.
    for (const combination of EVERY_COMBINATION) {
      for (const body of render(combination).values()) {
        expect(body).not.toMatch(/^\s*(import|export).*[Rr]agenVaultClient/m);
        expect(body).not.toMatch(/^RAGEN_TOKEN_VAULT_SERVICE_SECRET=/m);
        expect(body).not.toMatch(/^\s*RAGEN_TOKEN_VAULT_SERVICE_SECRET:/m);
      }
    }
  });

  it("documents the tool prefix Ragen actually uses — two underscores", () => {
    // `mergedTools[`${prefix}__${name}`]` in apps/web/src/libs/mcp/client.ts.
    // The README said `weather_<tool>` for its whole life: the template wrote
    // `__SLUG___<tool>`, and the substituter consumed one of the underscores.
    // This file exists to get the wire contract right, so getting it wrong in
    // prose is the same bug as getting it wrong in code.
    const readme = render(options()).get("README.md")!;
    expect(readme).toContain("`weather__<tool>`");
    expect(readme).not.toContain("`weather_<tool>`");
  });

  it("emits the catalogue URL with the /mcp suffix in the README", () => {
    // A row without it names a different address than the connector Ragen
    // creates from it.
    expect(render(options()).get("README.md")).toContain(":9005/mcp");
  });

  it("carries the auth shape into the README's catalogue table", () => {
    expect(render(options()).get("README.md")).toContain("SERVER_SIDE");
    expect(
      render(options({ auth: "api_key_bearer" })).get("README.md"),
    ).toContain("API_KEY_BEARER");
  });
});

describe("the two targets", () => {
  it("differ only where they must", () => {
    // Two whole templates would drift, and the drift would be invisible until
    // somebody's standalone connector encoded a contract that changed a
    // release ago. The target layer is allowed the manifest, the build config
    // it cannot inherit, and the runtime seam — nothing else.
    const workspace = render(options());
    const standalone = render(options({ target: "standalone" }));

    const differing = [...new Set([...workspace.keys(), ...standalone.keys()])]
      .filter((path) => workspace.get(path) !== standalone.get(path))
      .sort();

    expect(differing).toEqual([
      ".gitignore",
      ".nvmrc",
      "Dockerfile",
      "docker-compose.yml",
      "eslint.config.js",
      "package.json",
      "src/runtime/customer.ts",
      "src/runtime/env.ts",
      "src/runtime/index.ts",
      "src/runtime/instrument.ts",
      "src/runtime/logger.ts",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
  });

  it("shares the entrypoint, the tools and the tests byte for byte", () => {
    const workspace = render(options());
    const standalone = render(options({ target: "standalone" }));
    for (const shared of [
      "src/index.ts",
      "src/auth.ts",
      "src/tools/example-tools.ts",
      "src/services/example-api.ts",
      "src/__tests__/example-tools.test.ts",
      "src/__tests__/session.ts",
      "src/__tests__/auth.test.ts",
      "src/headers.ts",
      "README.md",
      ".env.example",
    ]) {
      expect(standalone.get(shared)).toBe(workspace.get(shared));
    }
  });
});

describe("free text a user typed", () => {
  // A label or description is the only thing here that is not constrained by
  // this CLI, and it lands in a JSON string and in TypeScript string literals.
  const awkward = options({
    label: 'Acme "Pro" CRM',
    description: 'Deals, contacts \\ "everything"',
  });

  it("keeps package.json parseable", () => {
    const manifest = render(awkward).get("package.json")!;
    expect(() => JSON.parse(manifest)).not.toThrow();
    expect(JSON.parse(manifest).description).toBe(
      'Deals, contacts \\ "everything"',
    );
  });

  it("keeps ragen-connector.json parseable", () => {
    // Built with JSON.stringify rather than substituted, but assert it — the
    // file is the handoff to the catalogue form.
    const entry = planFilesFor(awkward);
    expect(() => JSON.parse(entry)).not.toThrow();
    expect(JSON.parse(entry).label).toBe('Acme "Pro" CRM');
  });

  it("keeps the entrypoint's string literals closed", () => {
    const index = render(awkward).get("src/index.ts")!;
    expect(index).toContain('const NAME = "Acme \\"Pro\\" CRM";');
    // The label is stated once and referenced everywhere else, so there is
    // one quoting to get right. An unescaped copy inside a template literal
    // is what the two-quotings version produced, and ESLint rejected the
    // escaped form there as a useless escape.
    expect(index).not.toMatch(/`[^`]*Acme "Pro"/);
  });

  it("keeps free text out of comments, where escaping cannot save it", () => {
    // A label containing `*/` closed the generated file's header comment and
    // put the rest of the label into the file as code. Escaping is per file
    // type, not per position, so a string-literal escaper cannot fix a
    // comment — the label is simply not written into one. The slug can be:
    // it is `^[a-z][a-z0-9-]*$`.
    // Asserted by *where the label lands*, not by slicing the comment: the
    // first attempt cut the header at `indexOf("*/")`, which is the injected
    // terminator itself, so it passed with the bug reinstated.
    const marker = "Evil */ globalThis.pwned = 1; /*";
    const hostile = options({ label: marker });

    const index = render(hostile).get("src/index.ts")!;
    const lines = index.split("\n").filter((line) => line.includes("pwned"));
    expect(lines, "the label appears exactly once").toHaveLength(1);
    expect(lines[0].trim()).toMatch(/^const NAME = "/);

    // The tools file names the connector too, and must not carry it at all.
    expect(render(hostile).get("src/tools/example-tools.ts")).not.toContain(
      "pwned",
    );
  });

  it("does not escape anything in markdown, where there is nothing to break", () => {
    expect(render(awkward).get("README.md")).toContain('Acme "Pro" CRM');
  });

  it("does not substitute a token that appears inside a value", () => {
    // Substituting token by token meant a *value* containing a token was
    // itself rewritten by a later round: a label of `__PORT__` became the
    // port number, silently, in every file that carries the label.
    const index = render(options({ label: "__PORT__" })).get("src/index.ts")!;
    expect(index).toContain('const NAME = "__PORT__";');
    expect(index).not.toContain('const NAME = "8005";');
  });

  it("leaves a token nothing defines alone, so the plan can refuse it", () => {
    expect(substitute("__NOT_A_TOKEN__", options())).toBe("__NOT_A_TOKEN__");
  });

  it("neutralises a template-literal substitution in a label", () => {
    // `${...}` inside a generated backtick string would be evaluated.
    const index = render(options({ label: "A ${process.env.HOME} B" })).get(
      "src/index.ts",
    )!;
    expect(index).not.toContain("`A ${process.env.HOME} B");
  });
});

describe("identifierFor", () => {
  it("builds a usable identifier from a slug", () => {
    expect(identifierFor("weather")).toBe("Weather");
    expect(identifierFor("open-meteo")).toBe("OpenMeteo");
  });

  it("is built from the slug, not the label", () => {
    // `Rejestr.io (KRS)` is a fine name and not a fine identifier;
    // `registerRejestr.io(KRS)Tools` would fail to parse.
    expect(identifierFor("rejestr-io-krs")).toBe("RejestrIoKrs");
  });
});
