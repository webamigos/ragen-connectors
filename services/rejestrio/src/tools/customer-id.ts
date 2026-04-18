/**
 * MCP services in this monorepo encode the caller's auth tenant into
 * a `customer_id` string. Historical format in the google/clickup/
 * hubspot services:
 *
 *   {orgId}:{userId}:{provider}
 *
 * We only care about the first two fragments for audit/budget
 * attribution. Everything after is ignored but tolerated.
 */

export function parseCustomerId(
  customerId: string,
): { orgId: string | null; userId: string | null } {
  const parts = customerId.split(":");
  return {
    orgId: parts[0] ? parts[0] : null,
    userId: parts[1] ? parts[1] : null,
  };
}
