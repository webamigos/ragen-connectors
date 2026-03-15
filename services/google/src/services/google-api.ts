/**
 * Shared Google API HTTP helper with auto-refresh on 401.
 */

import { getAccessToken, refreshAndGetToken } from "../auth/token-store.js";

const TIMEOUT_MS = 30_000;

async function authHeaders(customerId: string): Promise<Record<string, string>> {
  const token = await getAccessToken(customerId);
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function refreshedHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function googleGet(
  customerId: string,
  url: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  let fullUrl = url;
  if (params) {fullUrl += `?${new URLSearchParams(params).toString()}`;}

  let resp = await fetch(fullUrl, {
    headers: await authHeaders(customerId),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (resp.status === 401) {
    const token = await refreshAndGetToken(customerId);
    resp = await fetch(fullUrl, {
      headers: refreshedHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  if (!resp.ok) {
    let body: string;
    try {
      body = await resp.text();
    } catch {
      body = "";
    }
    throw new Error(`Google API GET ${url} failed (${resp.status}): ${body}`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

export async function googlePost(
  customerId: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const opts: RequestInit = {
    method: "POST",
    headers: await authHeaders(customerId),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (body) {opts.body = JSON.stringify(body);}

  let resp = await fetch(url, opts);

  if (resp.status === 401) {
    const token = await refreshAndGetToken(customerId);
    opts.headers = refreshedHeaders(token);
    resp = await fetch(url, opts);
  }

  if (!resp.ok) {
    let body: string;
    try {
      body = await resp.text();
    } catch {
      body = "";
    }
    throw new Error(`Google API POST ${url} failed (${resp.status}): ${body}`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

export async function googleGetText(
  customerId: string,
  url: string,
  params?: Record<string, string>,
): Promise<string> {
  let fullUrl = url;
  if (params) {fullUrl += `?${new URLSearchParams(params).toString()}`;}

  let resp = await fetch(fullUrl, {
    headers: await authHeaders(customerId),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (resp.status === 401) {
    const token = await refreshAndGetToken(customerId);
    resp = await fetch(fullUrl, {
      headers: refreshedHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  if (!resp.ok) {
    let body: string;
    try {
      body = await resp.text();
    } catch {
      body = "";
    }
    throw new Error(`Google API GET ${url} failed (${resp.status}): ${body}`);
  }
  return resp.text();
}
