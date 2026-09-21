/**
 * Request headers as single values.
 *
 * Node types `IncomingMessage.headers` as `string | string[] | undefined`,
 * because a handful of headers may legitimately repeat. None of the ones a
 * connector reads do, so flattening is safe — but the types are not optional
 * and a cast would hide the day one of them does repeat.
 */

import type { IncomingMessage } from "node:http";

export function singleValueHeaders(
  request: IncomingMessage,
): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    // Node lowercases the names already, so callers can index with a literal.
    flat[name] = Array.isArray(value) ? value[0] : value;
  }
  return flat;
}
