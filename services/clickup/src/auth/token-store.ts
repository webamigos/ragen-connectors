/**
 * Per-customer token management for ClickUp via ragen-vault.
 */

import { RagenVaultClient, ragenVaultClient } from "@ragen-mcp/core";

const PROVIDER = "CLICKUP";

function client(): RagenVaultClient {
  if (!ragenVaultClient) {
    throw new Error(
      "ragen-vault client is not configured. " +
        "Set RAGEN_VAULT_URL and RAGEN_VAULT_SERVICE_SECRET environment variables.",
    );
  }
  return ragenVaultClient;
}

export async function saveTokens(
  customerId: string,
  accessToken: string,
): Promise<void> {
  await client().storeToken(customerId, PROVIDER, {
    access_token: accessToken,
  });
}

export async function getAccessToken(customerId: string): Promise<string> {
  let tokenData: Record<string, unknown>;
  try {
    tokenData = await client().getToken(customerId, PROVIDER);
  } catch (err) {
    throw new Error(
      `No tokens found for customer '${customerId}'. ` +
        `Please authenticate at /auth/clickup?customer_id=${customerId}`,
    );
  }
  const accessToken = tokenData.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error(
      `Invalid token data for customer '${customerId}'. ` +
        `Please re-authenticate at /auth/clickup?customer_id=${customerId}`,
    );
  }
  return accessToken;
}

export async function deleteTokens(customerId: string): Promise<void> {
  await client().deleteToken(customerId, PROVIDER);
}
