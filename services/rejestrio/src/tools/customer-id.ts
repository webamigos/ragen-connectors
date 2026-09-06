/**
 * MCP services in this monorepo encode the caller's auth tenant into
 * a `customer_id` string. Historical format in the google/clickup/
 * hubspot services:
 *
 *   {orgId}:{userId}:{provider}
 *
 * We only care about the first two fragments for audit/budget
 * attribution. Everything after is ignored but tolerated.
 *
 * On this service the org fragment is a spend control, not just an
 * audit label: `BudgetGuard` enforces the daily PLN ceiling per org,
 * so a call it cannot attribute is a call it cannot limit. Segments
 * are therefore trimmed and blank ones normalised to `null`, so that
 * ":u:R" and "  :u:R" both parse as "no org" rather than the second
 * one silently becoming an org literally named "  " with its own
 * fresh budget. The guard rejects a null org outright.
 */

function segment(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseCustomerId(
  customerId: string,
): { orgId: string | null; userId: string | null } {
  const parts = customerId.split(":");
  return {
    orgId: segment(parts[0]),
    userId: segment(parts[1]),
  };
}
