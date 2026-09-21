import { describe, expect, it } from "vitest";
import { TEMPLATED_AUTH_TYPES } from "../args.js";
import {
  identifierFor,
  render,
  unresolvedTokens,
  type RenderOptions,
} from "../render.js";

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
