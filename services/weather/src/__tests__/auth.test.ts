import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { authenticate, credentialProblem } from "../auth.js";

function request(headers: Record<string, string | string[]>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe("authenticate", () => {
  it("accepts a session with no headers at all", async () => {
    // This is Ragen's "Test connection" button: it opens an MCP session
    // against the URL an operator just typed and lists the tool names, with
    // no headers. It is the only evidence they get that the address is right
    // before a customer finds out it is not.
    //
    // Refusing here would make this connector look broken at exactly the
    // moment somebody was checking whether it worked. Delete this test only
    // together with that expectation.
    await expect(authenticate(request({}))).resolves.toEqual({
      customerId: null,
    });
  });

  it("carries the customer id when Ragen sends one", async () => {
    const session = await authenticate(
      request({ "x-customer-id": "org:user:weather" }),
    );
    expect(session.customerId).toBe("org:user:weather");
  });

  it("flattens a repeated header rather than handing on an array", async () => {
    const session = await authenticate(
      request({ "x-customer-id": ["first", "second"] }),
    );
    expect(session.customerId).toBe("first");
  });

  it("never reports a credential problem, because there is no credential", () => {
    expect(credentialProblem({})).toBeNull();
  });
});
