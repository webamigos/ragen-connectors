import { describe, expect, it } from "vitest";
import { parseArgs, TEMPLATED_AUTH_TYPES } from "../args.js";

describe("parseArgs", () => {
  it("takes the name as the only positional", () => {
    expect(parseArgs(["Weather"]).name).toBe("Weather");
  });

  it("refuses a second positional rather than adopting it as the name", () => {
    // `--port 9005` would otherwise leave 9005 as the name and the port
    // unset, which fails much later and for a reason that looks unrelated.
    expect(() => parseArgs(["Weather", "9005"])).toThrow(/Flag values must use --name=value/);
  });

  it("names external_mcp specifically, rather than listing what it accepts", () => {
    // The generic "expected one of" would read as a typo. It is not: the
    // shape exists in Ragen and this CLI cannot generate it.
    expect(() => parseArgs(["--auth=external_mcp"])).toThrow(
      /not templated.*authorization server/s,
    );
  });

  it("refuses an unknown auth shape", () => {
    expect(() => parseArgs(["--auth=magic"])).toThrow(
      new RegExp(TEMPLATED_AUTH_TYPES.join(", ")),
    );
  });

  it("refuses a port whose MCP sibling would not fit", () => {
    // 65000 + 1000 is past the end of the port space, and the failure would
    // otherwise be an EADDRINUSE-shaped mystery at boot.
    expect(() => parseArgs(["--port=65000"])).toThrow(/port \+ 1000/);
  });

  it("refuses a non-numeric port", () => {
    expect(() => parseArgs(["--port=nine"])).toThrow(/not a usable port/);
  });

  it("refuses a slug the catalogue form would refuse", () => {
    expect(() => parseArgs(["--slug=Weather"])).toThrow(/lowercase letters/);
  });

  it("refuses a slug that collides with a built-in case-insensitively", () => {
    expect(() => parseArgs(["--slug=slack"])).toThrow(/x-customer-id/);
  });

  it("reads the flags it is given", () => {
    const args = parseArgs([
      "Weather",
      "--slug=weather",
      "--auth=api_key_bearer",
      "--port=8090",
      "--icon=cloud-sun",
      "--target=standalone",
      "--skip-install",
      "--yes",
    ]);
    expect(args).toMatchObject({
      name: "Weather",
      slug: "weather",
      auth: "api_key_bearer",
      port: 8090,
      icon: "cloud-sun",
      target: "standalone",
      skipInstall: true,
      yes: true,
    });
  });

  it("leaves unset flags undefined so the CLI knows to ask", () => {
    const args = parseArgs(["Weather"]);
    expect(args.auth).toBeUndefined();
    expect(args.port).toBeUndefined();
    expect(args.slug).toBeUndefined();
  });
});
