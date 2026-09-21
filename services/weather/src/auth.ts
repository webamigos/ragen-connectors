/**
 * `server_side` — this connector holds no per-customer credential.
 *
 * Ragen sends `x-customer-id` and nothing else, the catalogue entry goes
 * straight to CONNECTED with no consent screen, and every tool call carries
 * `customer_id` as a parameter. That is the whole authentication story, and it
 * is the right one when the upstream needs no credential of its own (public
 * data) or when one service-wide key covers every customer.
 *
 * **If one service-wide key covers every customer, it is still your job to
 * stop one customer spending another's quota.** A paid upstream behind a
 * single key needs a per-customer ceiling and a cost audit keyed on
 * `customer_id`, or the first customer to loop a tool call spends the budget
 * for all of them.
 *
 * ## Why this refuses nothing
 *
 * The obvious thing to write here is a guard: no `x-customer-id`, no session.
 * It would make this connector fail the one check an operator actually runs.
 *
 * Ragen's **Test connection** button opens an MCP session against the URL just
 * typed and lists the tool names — with **no headers at all**. That is the
 * only evidence an operator gets that the address is right and the server
 * speaks MCP, and a connector that refused it would look broken at exactly the
 * moment somebody was checking whether it worked.
 *
 * So the session is accepted and the customer id is carried when it is there.
 * The trade is that anyone who can reach this port can list tool *names*; they
 * cannot get a useful answer out of one, because every tool takes
 * `customer_id` as a parameter and the data is scoped by it. If your
 * deployment cannot accept even the name list being readable, put the port
 * behind your network — and know that Test connection will then fail from
 * outside it.
 */

import type { IncomingMessage } from "node:http";
import { singleValueHeaders } from "./headers.js";

export interface Session extends Record<string, unknown> {
  /** Null for a session Ragen's Test connection opened. */
  customerId: string | null;
}

export async function authenticate(request: IncomingMessage): Promise<Session> {
  return { customerId: singleValueHeaders(request)["x-customer-id"] ?? null };
}

/** No credential to resolve. The parameter exists so the tools stay identical across auth shapes. */
export function credentialFor(_context: unknown): string | null {
  return null;
}

/** Nothing can be missing when nothing is required. */
export function credentialProblem(_context: unknown): string | null {
  return null;
}
