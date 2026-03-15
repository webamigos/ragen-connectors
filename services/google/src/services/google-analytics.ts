/**
 * Google Analytics (GA4) Data API service layer.
 */

import { googlePost } from "./google-api.js";

const BASE = "https://analyticsdata.googleapis.com/v1beta";

interface GA4Row {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}

interface GA4Response {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: GA4Row[];
  rowCount?: number;
}

function rowsToDicts(response: GA4Response): Record<string, string>[] {
  const dimHeaders = (response.dimensionHeaders ?? []).map((h) => h.name);
  const metHeaders = (response.metricHeaders ?? []).map((h) => h.name);

  return (response.rows ?? []).map((row) => {
    const entry: Record<string, string> = {};
    (row.dimensionValues ?? []).forEach((dim, i) => {
      entry[dimHeaders[i]!] = dim.value;
    });
    (row.metricValues ?? []).forEach((met, i) => {
      entry[metHeaders[i]!] = met.value;
    });
    return entry;
  });
}

export async function getTrafficReport(
  customerId: string,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, unknown>> {
  const response = (await googlePost(
    customerId,
    `${BASE}/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "sessions" },
        { name: "totalUsers" },
        { name: "newUsers" },
        { name: "screenPageViews" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
      ],
      dateRanges: [{ startDate, endDate }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    },
  )) as unknown as GA4Response;

  return {
    property_id: propertyId,
    date_range: { start: startDate, end: endDate },
    row_count: response.rowCount ?? 0,
    data: rowsToDicts(response),
  };
}

export async function getConversionData(
  customerId: string,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, unknown>> {
  const response = (await googlePost(
    customerId,
    `${BASE}/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      dimensions: [{ name: "eventName" }],
      metrics: [
        { name: "eventCount" },
        { name: "totalUsers" },
        { name: "eventValue" },
      ],
      dateRanges: [{ startDate, endDate }],
      orderBys: [
        { metric: { metricName: "eventCount" }, desc: true },
      ],
    },
  )) as unknown as GA4Response;

  return {
    property_id: propertyId,
    date_range: { start: startDate, end: endDate },
    row_count: response.rowCount ?? 0,
    events: rowsToDicts(response),
  };
}

export async function getTopPages(
  customerId: string,
  propertyId: string,
  startDate: string,
  endDate: string,
  limit = 20,
): Promise<Record<string, unknown>> {
  const response = (await googlePost(
    customerId,
    `${BASE}/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [
        { name: "screenPageViews" },
        { name: "totalUsers" },
        { name: "averageSessionDuration" },
        { name: "bounceRate" },
      ],
      dateRanges: [{ startDate, endDate }],
      orderBys: [
        { metric: { metricName: "screenPageViews" }, desc: true },
      ],
      limit,
    },
  )) as unknown as GA4Response;

  const rows = rowsToDicts(response);

  return {
    property_id: propertyId,
    date_range: { start: startDate, end: endDate },
    total_pages: response.rowCount ?? 0,
    showing: rows.length,
    pages: rows,
  };
}

export async function getAudienceInsights(
  customerId: string,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, unknown>> {
  const deviceResponse = (await googlePost(
    customerId,
    `${BASE}/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      dateRanges: [{ startDate, endDate }],
      orderBys: [
        { metric: { metricName: "sessions" }, desc: true },
      ],
    },
  )) as unknown as GA4Response;

  const countryResponse = (await googlePost(
    customerId,
    `${BASE}/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      dimensions: [{ name: "country" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      dateRanges: [{ startDate, endDate }],
      orderBys: [
        { metric: { metricName: "sessions" }, desc: true },
      ],
      limit: 15,
    },
  )) as unknown as GA4Response;

  return {
    property_id: propertyId,
    date_range: { start: startDate, end: endDate },
    devices: rowsToDicts(deviceResponse),
    top_countries: rowsToDicts(countryResponse),
  };
}
