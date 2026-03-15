/**
 * FastMCP tool definitions for Google Calendar.
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import * as calendar from "../services/google-calendar.js";

export function registerCalendarTools(mcp: FastMCP): void {
  mcp.addTool({
    name: "list_calendars",
    description: "List all Google Calendars accessible by the authenticated user.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
    }),
    execute: async ({ customer_id }) => {
      try {
        const calendars = await calendar.listCalendars(customer_id);
        return JSON.stringify({ success: true, calendars, count: calendars.length });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "list_calendar_events",
    description: "List events from a Google Calendar within a time range.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      calendar_id: z.string().default("primary").describe("Calendar ID (default 'primary')"),
      time_min: z.string().default("").describe("Start of time range in RFC3339 format. Defaults to now."),
      time_max: z.string().default("").describe("End of time range in RFC3339 format."),
      max_results: z.number().default(10).describe("Maximum number of events to return."),
      query: z.string().default("").describe("Free-text search query to filter events."),
    }),
    execute: async ({ customer_id, calendar_id, time_min, time_max, max_results, query }) => {
      try {
        const data = await calendar.listEvents(
          customer_id,
          calendar_id,
          time_min || undefined,
          time_max || undefined,
          max_results,
          query || undefined,
        );
        return JSON.stringify({ success: true, ...data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_calendar_event",
    description: "Get details of a specific Google Calendar event.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      calendar_id: z.string().describe("Calendar ID containing the event"),
      event_id: z.string().describe("The event ID to retrieve"),
    }),
    execute: async ({ customer_id, calendar_id, event_id }) => {
      try {
        const event = await calendar.getEvent(customer_id, calendar_id, event_id);
        return JSON.stringify({ success: true, event });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "check_free_busy",
    description: "Check free/busy availability for one or more Google Calendars.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      time_min: z.string().describe("Start of time range in RFC3339 format"),
      time_max: z.string().describe("End of time range in RFC3339 format"),
      calendar_ids: z.array(z.string()).optional().describe("Calendar IDs to check. Defaults to ['primary']."),
    }),
    execute: async ({ customer_id, time_min, time_max, calendar_ids }) => {
      try {
        const ids = calendar_ids ?? ["primary"];
        const data = await calendar.getFreeBusy(customer_id, ids, time_min, time_max);
        return JSON.stringify({ success: true, ...data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });
}
