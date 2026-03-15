/**
 * Per-customer token management for HubSpot via ragen-vault with auto-refresh.
 */

import { RagenVaultClient, ragenVaultClient } from "@ragen-mcp/core";

const PROVIDER = "HUBSPOT";
const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID ?? "";
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET ?? "";

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
  refreshToken: string,
): Promise<void> {
  await client().storeToken(customerId, PROVIDER, {
    access_token: accessToken,
    refresh_token: refreshToken,
    client_id: HUBSPOT_CLIENT_ID,
    client_secret: HUBSPOT_CLIENT_SECRET,
  });
}

export async function getAccessToken(customerId: string): Promise<string> {
  let tokenData: Record<string, unknown>;
  try {
    tokenData = await client().getToken(customerId, PROVIDER);
  } catch (err) {
    throw new Error(
      `No tokens found for customer '${customerId}'. ` +
        `Please authenticate at /auth/hubspot?customer_id=${customerId}`,
    );
  }
  const accessToken = tokenData.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error(
      `Invalid token data for customer '${customerId}'. ` +
        `Please re-authenticate at /auth/hubspot?customer_id=${customerId}`,
    );
  }
  return accessToken;
}

export async function refreshAndGetToken(customerId: string): Promise<string> {
  if (!HUBSPOT_CLIENT_ID || !HUBSPOT_CLIENT_SECRET) {
    throw new Error(
      "HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET environment variables must be set",
    );
  }

  let tokenData: Record<string, unknown>;
  try {
    tokenData = await client().getToken(customerId, PROVIDER);
  } catch (err) {
    throw new Error(
      `No tokens found for customer '${customerId}'. ` +
        `Please authenticate at /auth/hubspot?customer_id=${customerId}`,
    );
  }

  const refreshToken = tokenData.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new Error(`No refresh token found for customer '${customerId}'`);
  }

  const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: HUBSPOT_CLIENT_ID,
      client_secret: HUBSPOT_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    let errorDetail: string;
    try {
      const body = (await resp.json()) as Record<string, unknown>;
      errorDetail = (body.message as string) ?? resp.statusText;
    } catch {
      errorDetail = resp.statusText;
    }
    throw new Error(
      `HubSpot token refresh failed for customer '${customerId}': ${errorDetail}`,
    );
  }

  const newTokenData = (await resp.json()) as Record<string, unknown>;
  const newAccessToken = newTokenData.access_token;
  if (typeof newAccessToken !== "string" || !newAccessToken) {
    throw new Error(
      `HubSpot returned invalid token response for customer '${customerId}'`,
    );
  }
  const newRefreshToken =
    typeof newTokenData.refresh_token === "string"
      ? newTokenData.refresh_token
      : refreshToken;

  await saveTokens(customerId, newAccessToken, newRefreshToken);
  return newAccessToken;
}

export async function deleteTokens(customerId: string): Promise<void> {
  await client().deleteToken(customerId, PROVIDER);
}
