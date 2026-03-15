/**
 * HTTP client for the ragen-token-vault token vault service.
 * Uses HMAC-SHA256 service-to-service authentication.
 */

import { createHmac, createHash } from "node:crypto";

const SERVICE_NAME = process.env.RAGEN_TOKEN_VAULT_SERVICE_NAME ?? "ragen-mcp-ts";

export class RagenVaultClient {
  private baseUrl: string;
  private secret: string;

  constructor(baseUrl?: string, secret?: string) {
    this.baseUrl = (baseUrl ?? process.env.RAGEN_TOKEN_VAULT_URL ?? "").replace(
      /\/$/,
      "",
    );
    this.secret = secret ?? process.env.RAGEN_TOKEN_VAULT_SERVICE_SECRET ?? "";
    if (!this.baseUrl) {
      throw new Error("RAGEN_TOKEN_VAULT_URL environment variable is required");
    }
    if (!this.secret) {
      throw new Error(
        "RAGEN_TOKEN_VAULT_SERVICE_SECRET environment variable is required",
      );
    }
  }

  // -- HMAC signature --

  private sign(
    method: string,
    path: string,
    body = "",
  ): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodySha256 = createHash("sha256").update(body).digest("hex");
    const message = `${timestamp}\n${method}\n${path}\n${bodySha256}`;
    const sig = createHmac("sha256", this.secret)
      .update(message)
      .digest("hex");
    return {
      Authorization: `HMAC-SHA256 ts=${timestamp},sig=${sig}`,
      "X-Service-Name": SERVICE_NAME,
    };
  }

  // -- HTTP helpers --

  private async request(
    method: string,
    path: string,
    options?: { json?: Record<string, unknown>; params?: Record<string, string>; followRedirects?: boolean },
  ): Promise<Response> {
    let body = "";
    const headers: Record<string, string> = {};

    if (options?.json) {
      body = JSON.stringify(options.json);
      headers["Content-Type"] = "application/json";
    }

    Object.assign(headers, this.sign(method.toUpperCase(), path, body));

    let url = `${this.baseUrl}${path}`;
    if (options?.params) {
      const qs = new URLSearchParams(options.params).toString();
      url += `?${qs}`;
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: options?.json ? body : undefined,
      redirect: options?.followRedirects === false ? "manual" : "follow",
    });

    if (!resp.ok && resp.status !== 301 && resp.status !== 302) {
      const text = await resp.text();
      throw new Error(
        `ragen-token-vault ${method} ${path} failed (${resp.status}): ${text}`,
      );
    }
    return resp;
  }

  // -- Token CRUD --

  private tokenPath(customerId: string, provider: string): string {
    return `/v1/tokens/${encodeURIComponent(customerId)}/${encodeURIComponent(provider)}`;
  }

  async storeToken(
    customerId: string,
    provider: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const resp = await this.request(
      "PUT",
      this.tokenPath(customerId, provider),
      { json: data },
    );
    return (await resp.json()) as Record<string, unknown>;
  }

  async getToken(
    customerId: string,
    provider: string,
  ): Promise<Record<string, unknown>> {
    const resp = await this.request(
      "GET",
      this.tokenPath(customerId, provider),
    );
    return (await resp.json()) as Record<string, unknown>;
  }

  async deleteToken(customerId: string, provider: string): Promise<void> {
    await this.request("DELETE", this.tokenPath(customerId, provider));
  }

  async getTokenStatus(
    customerId: string,
    provider: string,
  ): Promise<Record<string, unknown>> {
    const resp = await this.request(
      "GET",
      `${this.tokenPath(customerId, provider)}/status`,
    );
    return (await resp.json()) as Record<string, unknown>;
  }

  async listTokens(
    customerId: string,
  ): Promise<Record<string, unknown>> {
    const path = `/v1/tokens/${encodeURIComponent(customerId)}`;
    const resp = await this.request("GET", path);
    return (await resp.json()) as Record<string, unknown>;
  }

  // -- Google OAuth helpers --

  async getGoogleAuthUrl(
    customerId: string,
    scopes: string,
    redirectUri: string,
    provider = "GOOGLE",
  ): Promise<string> {
    const resp = await this.request("GET", "/v1/oauth/google/authorize", {
      params: {
        customer_id: customerId,
        scopes,
        redirect_uri: redirectUri,
        provider,
      },
      followRedirects: false,
    });
    const location = resp.headers.get("location");
    if (!location) {
      throw new Error(
        "ragen-token-vault did not return a redirect Location header",
      );
    }
    return location;
  }

  async refreshGoogleToken(
    customerId: string,
    provider = "GOOGLE",
  ): Promise<Record<string, unknown>> {
    const resp = await this.request("POST", "/v1/oauth/google/refresh", {
      json: { customer_id: customerId, provider },
    });
    return (await resp.json()) as Record<string, unknown>;
  }
}

// Module-level singleton (null if env vars not set)
function createClient(): RagenVaultClient | null {
  const url = process.env.RAGEN_TOKEN_VAULT_URL ?? "";
  const secret = process.env.RAGEN_TOKEN_VAULT_SERVICE_SECRET ?? "";
  if (url && secret) {
    return new RagenVaultClient(url, secret);
  }
  return null;
}

export const ragenVaultClient = createClient();
