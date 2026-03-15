/**
 * FastMCP tool definitions for Google Analytics (GA4).
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import * as analytics from "../services/google-analytics.js";

export function registerAnalyticsTools(mcp: FastMCP): void {
  mcp.addTool({
    name: "get_traffic_report",
    description: "Get a website traffic report: sessions, users, page views by date.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      property_id: z.string().describe("The GA4 property ID (numeric, e.g. '123456789')"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format (or '7daysAgo', '30daysAgo')"),
      end_date: z.string().describe("End date in YYYY-MM-DD format (or 'today', 'yesterday')"),
    }),
    execute: async ({ customer_id, property_id, start_date, end_date }) => {
      try {
        const report = await analytics.getTrafficReport(customer_id, property_id, start_date, end_date);
        return JSON.stringify({ success: true, ...report });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_conversion_data",
    description: "Get conversion event data from Google Analytics.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      property_id: z.string().describe("The GA4 property ID (numeric)"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format (or '7daysAgo', '30daysAgo')"),
      end_date: z.string().describe("End date in YYYY-MM-DD format (or 'today', 'yesterday')"),
    }),
    execute: async ({ customer_id, property_id, start_date, end_date }) => {
      try {
        const data = await analytics.getConversionData(customer_id, property_id, start_date, end_date);
        return JSON.stringify({ success: true, ...data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_top_pages",
    description: "Get top pages by page views from Google Analytics.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      property_id: z.string().describe("The GA4 property ID (numeric)"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format (or '7daysAgo', '30daysAgo')"),
      end_date: z.string().describe("End date in YYYY-MM-DD format (or 'today', 'yesterday')"),
      limit: z.number().default(20).describe("Maximum number of pages to return."),
    }),
    execute: async ({ customer_id, property_id, start_date, end_date, limit }) => {
      try {
        const data = await analytics.getTopPages(customer_id, property_id, start_date, end_date, limit);
        return JSON.stringify({ success: true, ...data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_audience_insights",
    description: "Get audience insights: device categories, top countries.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      property_id: z.string().describe("The GA4 property ID (numeric)"),
      start_date: z.string().describe("Start date in YYYY-MM-DD format (or '7daysAgo', '30daysAgo')"),
      end_date: z.string().describe("End date in YYYY-MM-DD format (or 'today', 'yesterday')"),
    }),
    execute: async ({ customer_id, property_id, start_date, end_date }) => {
      try {
        const data = await analytics.getAudienceInsights(customer_id, property_id, start_date, end_date);
        return JSON.stringify({ success: true, ...data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });
}
