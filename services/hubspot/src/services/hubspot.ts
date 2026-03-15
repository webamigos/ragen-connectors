/**
 * HubSpot API service layer (readonly).
 */

import { getAccessToken, refreshAndGetToken } from "../auth/token-store.js";

const BASE_URL = "https://api.hubapi.com";
const TIMEOUT_MS = 30_000;

async function headers(customerId: string): Promise<Record<string, string>> {
  const token = await getAccessToken(customerId);
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function get(
  customerId: string,
  path: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  let url = `${BASE_URL}${path}`;
  if (params) {url += `?${new URLSearchParams(params).toString()}`;}

  let resp = await fetch(url, {
    headers: await headers(customerId),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // Auto-refresh on 401
  if (resp.status === 401) {
    const token = await refreshAndGetToken(customerId);
    resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  if (!resp.ok) {
    throw new Error(`HubSpot API GET ${path} failed (${resp.status})`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

async function post(
  customerId: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const opts: RequestInit = {
    method: "POST",
    headers: await headers(customerId),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (body) {opts.body = JSON.stringify(body);}

  let resp = await fetch(`${BASE_URL}${path}`, opts);

  if (resp.status === 401) {
    const token = await refreshAndGetToken(customerId);
    opts.headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    resp = await fetch(`${BASE_URL}${path}`, opts);
  }

  if (!resp.ok) {
    throw new Error(`HubSpot API POST ${path} failed (${resp.status})`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

// --- Contacts ---

export async function getContacts(
  customerId: string,
  limit = 10,
  after?: string,
  properties?: string[],
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { limit: String(limit) };
  if (after) {params.after = after;}
  if (properties) {params.properties = properties.join(",");}
  const data = await get(customerId, "/crm/v3/objects/contacts", params);
  return {
    results: ((data.results ?? []) as Record<string, unknown>[]).map(formatObject),
    paging: data.paging,
  };
}

export async function getContact(
  customerId: string,
  contactId: string,
  properties?: string[],
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {};
  if (properties) {params.properties = properties.join(",");}
  const data = await get(customerId, `/crm/v3/objects/contacts/${contactId}`, Object.keys(params).length ? params : undefined);
  return formatObject(data);
}

// --- Companies ---

export async function getCompanies(
  customerId: string,
  limit = 10,
  after?: string,
  properties?: string[],
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { limit: String(limit) };
  if (after) {params.after = after;}
  if (properties) {params.properties = properties.join(",");}
  const data = await get(customerId, "/crm/v3/objects/companies", params);
  return {
    results: ((data.results ?? []) as Record<string, unknown>[]).map(formatObject),
    paging: data.paging,
  };
}

export async function getCompany(
  customerId: string,
  companyId: string,
  properties?: string[],
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {};
  if (properties) {params.properties = properties.join(",");}
  const data = await get(customerId, `/crm/v3/objects/companies/${companyId}`, Object.keys(params).length ? params : undefined);
  return formatObject(data);
}

// --- Deals ---

export async function getDeals(
  customerId: string,
  limit = 10,
  after?: string,
  properties?: string[],
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { limit: String(limit) };
  if (after) {params.after = after;}
  if (properties) {params.properties = properties.join(",");}
  const data = await get(customerId, "/crm/v3/objects/deals", params);
  return {
    results: ((data.results ?? []) as Record<string, unknown>[]).map(formatObject),
    paging: data.paging,
  };
}

export async function getDeal(
  customerId: string,
  dealId: string,
  properties?: string[],
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {};
  if (properties) {params.properties = properties.join(",");}
  const data = await get(customerId, `/crm/v3/objects/deals/${dealId}`, Object.keys(params).length ? params : undefined);
  return formatObject(data);
}

// --- Tickets ---

export async function getTickets(
  customerId: string,
  limit = 10,
  after?: string,
  properties?: string[],
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { limit: String(limit) };
  if (after) {params.after = after;}
  if (properties) {params.properties = properties.join(",");}
  const data = await get(customerId, "/crm/v3/objects/tickets", params);
  return {
    results: ((data.results ?? []) as Record<string, unknown>[]).map(formatObject),
    paging: data.paging,
  };
}

export async function getTicket(
  customerId: string,
  ticketId: string,
  properties?: string[],
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {};
  if (properties) {params.properties = properties.join(",");}
  const data = await get(customerId, `/crm/v3/objects/tickets/${ticketId}`, Object.keys(params).length ? params : undefined);
  return formatObject(data);
}

// --- Search ---

export async function searchObjects(
  customerId: string,
  objectType: string,
  query = "",
  filters?: Record<string, unknown>[],
  properties?: string[],
  limit = 10,
  after = 0,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { limit };
  if (query) {body.query = query;}
  if (after) {body.after = after;}
  if (properties) {body.properties = properties;}
  if (filters) {body.filterGroups = [{ filters }];}

  const data = await post(customerId, `/crm/v3/objects/${objectType}/search`, body);
  return {
    results: ((data.results ?? []) as Record<string, unknown>[]).map(formatObject),
    total: data.total ?? 0,
    paging: data.paging,
  };
}

// --- Pipelines ---

export async function getPipelines(
  customerId: string,
  objectType = "deals",
): Promise<Record<string, unknown>[]> {
  const data = await get(customerId, `/crm/v3/pipelines/${objectType}`);
  return ((data.results ?? []) as Record<string, unknown>[]).map((p) => ({
    id: p.id,
    label: p.label,
    display_order: p.displayOrder ?? 0,
    stages: ((p.stages ?? []) as Record<string, unknown>[]).map((s) => ({
      id: s.id,
      label: s.label,
      display_order: s.displayOrder ?? 0,
    })),
  }));
}

// --- Owners ---

export async function getOwners(
  customerId: string,
  limit = 100,
  after?: string,
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { limit: String(limit) };
  if (after) {params.after = after;}
  const data = await get(customerId, "/crm/v3/owners", params);
  return {
    results: ((data.results ?? []) as Record<string, unknown>[]).map((o) => ({
      id: o.id,
      email: o.email ?? "",
      first_name: o.firstName ?? "",
      last_name: o.lastName ?? "",
      user_id: o.userId,
    })),
    paging: data.paging,
  };
}

// --- Associations ---

export async function getAssociations(
  customerId: string,
  fromObjectType: string,
  fromObjectId: string,
  toObjectType: string,
): Promise<Record<string, unknown>[]> {
  const data = await get(
    customerId,
    `/crm/v4/objects/${fromObjectType}/${fromObjectId}/associations/${toObjectType}`,
  );
  return ((data.results ?? []) as Record<string, unknown>[]).map((r) => ({
    to_object_id: r.toObjectId,
    association_types: ((r.associationTypes ?? []) as Record<string, unknown>[]).map((t) => ({
      category: t.category ?? "",
      type_id: t.typeId,
      label: t.label ?? "",
    })),
  }));
}

// --- Properties ---

export async function getProperties(
  customerId: string,
  objectType: string,
): Promise<Record<string, unknown>[]> {
  const data = await get(customerId, `/crm/v3/properties/${objectType}`);
  return ((data.results ?? []) as Record<string, unknown>[]).map((p) => ({
    name: p.name,
    label: p.label,
    type: p.type,
    field_type: p.fieldType ?? "",
    group_name: p.groupName ?? "",
    description: p.description ?? "",
  }));
}

// --- Helpers ---

function formatObject(obj: Record<string, unknown>): Record<string, unknown> {
  return {
    id: obj.id ?? "",
    properties: obj.properties ?? {},
    created_at: obj.createdAt ?? "",
    updated_at: obj.updatedAt ?? "",
    archived: obj.archived ?? false,
  };
}
