/**
 * FastMCP tool definitions for Google Ads.
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import * as ads from "../services/google-ads.js";

export function registerAdsTools(mcp: FastMCP): void {
  mcp.addTool({
    name: "list_campaigns",
    description: "List all Google Ads campaigns for an account.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      ads_customer_id: z.string().describe("The Google Ads customer ID (10-digit, no dashes)"),
    }),
    execute: async ({ customer_id, ads_customer_id }) => {
      try {
        const campaigns = await ads.listCampaigns(customer_id, ads_customer_id);
        return JSON.stringify({ success: true, campaigns, count: campaigns.length });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_campaign_performance",
    description: "Get performance metrics for a specific Google Ads campaign.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      ads_customer_id: z.string().describe("The Google Ads customer ID (10-digit, no dashes)"),
      campaign_name: z.string().describe("Exact name of the campaign"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
    }),
    execute: async ({ customer_id, ads_customer_id, campaign_name, start_date, end_date }) => {
      try {
        const data = await ads.getCampaignPerformance(
          customer_id, ads_customer_id, campaign_name, start_date, end_date,
        );
        return JSON.stringify({ success: true, performance: data, days: data.length });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_cost_summary",
    description: "Get a cost summary across all campaigns for a date range.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      ads_customer_id: z.string().describe("The Google Ads customer ID (10-digit, no dashes)"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
    }),
    execute: async ({ customer_id, ads_customer_id, start_date, end_date }) => {
      try {
        const summary = await ads.getCostSummary(customer_id, ads_customer_id, start_date, end_date);
        return JSON.stringify({ ...summary, success: true });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });
}
