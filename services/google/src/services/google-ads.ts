/**
 * Google Ads API service layer.
 */

import { getAccessToken, refreshAndGetToken } from "../auth/token-store.js";

const ADS_API_VERSION = "v19";
const BASE = `https://googleads.googleapis.com/${ADS_API_VERSION}`;
const TIMEOUT_MS = 30_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
const LOGIN_CUSTOMER_ID = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "";

function sanitizeDate(date: string): string {
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid date format: '${date}'. Expected YYYY-MM-DD.`);
  }
  return date;
}

function sanitizeGaqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

interface AdsRow {
  campaign?: {
    id?: string;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
    biddingStrategyType?: string;
  };
  metrics?: {
    impressions?: string;
    clicks?: string;
    costMicros?: string;
    conversions?: number;
    conversionsValue?: number;
    ctr?: number;
    averageCpc?: string;
  };
  segments?: {
    date?: string;
  };
}

async function adsSearch(
  customerId: string,
  adsCustomerId: string,
  query: string,
): Promise<AdsRow[]> {
  if (!DEVELOPER_TOKEN) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN environment variable must be set");
  }

  const url = `${BASE}/customers/${adsCustomerId}/googleAds:search`;

  const buildHeaders = async (token: string): Promise<Record<string, string>> => {
    const h: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "developer-token": DEVELOPER_TOKEN,
    };
    if (LOGIN_CUSTOMER_ID) {
      h["login-customer-id"] = LOGIN_CUSTOMER_ID;
    }
    return h;
  };

  let token = await getAccessToken(customerId);
  let resp = await fetch(url, {
    method: "POST",
    headers: await buildHeaders(token),
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (resp.status === 401) {
    token = await refreshAndGetToken(customerId);
    resp = await fetch(url, {
      method: "POST",
      headers: await buildHeaders(token),
      body: JSON.stringify({ query }),
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
    throw new Error(`Google Ads API search failed (${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as { results?: AdsRow[] }[];
  // searchStream returns an array of response chunks; search returns { results: [...] }
  const allResults: AdsRow[] = [];
  if (Array.isArray(data)) {
    for (const chunk of data) {
      if (chunk.results) {allResults.push(...chunk.results);}
    }
  }
  return allResults;
}

export async function listCampaigns(
  customerId: string,
  adsCustomerId: string,
): Promise<Record<string, unknown>[]> {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type
    FROM campaign
    ORDER BY campaign.id
  `;

  const rows = await adsSearch(customerId, adsCustomerId, query);
  return rows.map((row) => ({
    id: row.campaign?.id ?? "",
    name: row.campaign?.name ?? "",
    status: row.campaign?.status ?? "",
    channel_type: row.campaign?.advertisingChannelType ?? "",
    bidding_strategy: row.campaign?.biddingStrategyType ?? "",
  }));
}

export async function getCampaignPerformance(
  customerId: string,
  adsCustomerId: string,
  campaignName: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, unknown>[]> {
  const safeName = sanitizeGaqlString(campaignName);
  const safeStart = sanitizeDate(startDate);
  const safeEnd = sanitizeDate(endDate);
  const query = `
    SELECT
      campaign.name,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE campaign.name = '${safeName}'
      AND segments.date BETWEEN '${safeStart}' AND '${safeEnd}'
    ORDER BY segments.date DESC
  `;

  const rows = await adsSearch(customerId, adsCustomerId, query);
  return rows.map((row) => {
    const costMicros = parseInt(row.metrics?.costMicros ?? "0", 10);
    const avgCpcMicros = parseInt(row.metrics?.averageCpc ?? "0", 10);
    return {
      campaign: row.campaign?.name ?? "",
      date: row.segments?.date ?? "",
      impressions: parseInt(row.metrics?.impressions ?? "0", 10),
      clicks: parseInt(row.metrics?.clicks ?? "0", 10),
      cost: costMicros / 1_000_000,
      conversions: Math.round((row.metrics?.conversions ?? 0) * 100) / 100,
      conversion_value: Math.round((row.metrics?.conversionsValue ?? 0) * 100) / 100,
      ctr: Math.round((row.metrics?.ctr ?? 0) * 10000) / 100,
      avg_cpc: avgCpcMicros / 1_000_000,
    };
  });
}

export async function getCostSummary(
  customerId: string,
  adsCustomerId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, unknown>> {
  const safeStart = sanitizeDate(startDate);
  const safeEnd = sanitizeDate(endDate);
  const query = `
    SELECT
      campaign.name,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${safeStart}' AND '${safeEnd}'
    ORDER BY metrics.cost_micros DESC
  `;

  const rows = await adsSearch(customerId, adsCustomerId, query);

  let totalCost = 0;
  let totalClicks = 0;
  let totalImpressions = 0;
  let totalConversions = 0;

  const campaigns = rows.map((row) => {
    const costMicros = parseInt(row.metrics?.costMicros ?? "0", 10);
    const cost = costMicros / 1_000_000;
    const clicks = parseInt(row.metrics?.clicks ?? "0", 10);
    const impressions = parseInt(row.metrics?.impressions ?? "0", 10);
    const conversions = row.metrics?.conversions ?? 0;

    totalCost += cost;
    totalClicks += clicks;
    totalImpressions += impressions;
    totalConversions += conversions;

    return {
      campaign: row.campaign?.name ?? "",
      cost,
      clicks,
      impressions,
      conversions: Math.round(conversions * 100) / 100,
    };
  });

  return {
    date_range: { start: startDate, end: endDate },
    total_cost: Math.round(totalCost * 100) / 100,
    total_clicks: totalClicks,
    total_impressions: totalImpressions,
    total_conversions: Math.round(totalConversions * 100) / 100,
    campaigns,
  };
}
