/**
 * Multi-tenancy: extract customer_id from MCP session context.
 *
 * FastMCP provides session/request context. The customer_id is passed
 * via the x-customer-id HTTP header by the MCP client.
 */

export function getCustomerId(headers: Record<string, string | undefined>): string {
  const customerId = headers["x-customer-id"];
  if (!customerId) {
    throw new Error("Missing x-customer-id header");
  }
  return customerId;
}
