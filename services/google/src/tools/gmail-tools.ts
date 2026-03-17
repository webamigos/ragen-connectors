/**
 * FastMCP tool definitions for Gmail (read-only).
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import * as gmail from "../services/google-gmail.js";

export function registerGmailTools(mcp: FastMCP): void {
  mcp.addTool({
    name: "gmail_get_profile",
    description: "Get the authenticated user's Gmail profile (email address, message/thread counts).",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
    }),
    execute: async ({ customer_id }) => {
      try {
        const profile = await gmail.getProfile(customer_id);
        return JSON.stringify({ success: true, ...profile });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "gmail_list_labels",
    description: "List all Gmail labels for the authenticated user.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
    }),
    execute: async ({ customer_id }) => {
      try {
        const labels = await gmail.listLabels(customer_id);
        return JSON.stringify({ success: true, labels, count: labels.length });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "gmail_search_messages",
    description: "Search Gmail messages using Gmail search syntax (e.g. 'from:user@example.com', 'subject:hello', 'is:unread'). Returns message IDs — use gmail_read_message to get full content.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      query: z.string().default("").describe("Gmail search query (same syntax as Gmail search bar)"),
      max_results: z.number().default(10).describe("Maximum number of messages to return (1-100)"),
      page_token: z.string().default("").describe("Page token for pagination"),
      label_ids: z.array(z.string()).optional().describe("Filter by label IDs (e.g. ['INBOX', 'UNREAD'])"),
    }),
    execute: async ({ customer_id, query, max_results, page_token, label_ids }) => {
      try {
        const data = await gmail.searchMessages(
          customer_id,
          query,
          max_results,
          page_token || undefined,
          label_ids,
        );
        return JSON.stringify({ success: true, ...data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "gmail_read_message",
    description: "Read a specific Gmail message by ID. Returns headers (from, to, subject, date), body text, labels, and snippet.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      message_id: z.string().describe("The Gmail message ID"),
      format: z.enum(["full", "metadata", "minimal"]).default("full").describe("Response format: 'full' (headers+body), 'metadata' (headers only), 'minimal' (IDs only)"),
    }),
    execute: async ({ customer_id, message_id, format }) => {
      try {
        const message = await gmail.readMessage(customer_id, message_id, format);
        return JSON.stringify({ success: true, message });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "gmail_read_thread",
    description: "Read an entire Gmail thread (conversation) by thread ID. Returns all messages in the thread.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      thread_id: z.string().describe("The Gmail thread ID"),
      format: z.enum(["full", "metadata", "minimal"]).default("full").describe("Response format for messages in the thread"),
    }),
    execute: async ({ customer_id, thread_id, format }) => {
      try {
        const thread = await gmail.readThread(customer_id, thread_id, format);
        return JSON.stringify({ success: true, ...thread });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "gmail_list_drafts",
    description: "List Gmail drafts for the authenticated user.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      max_results: z.number().default(10).describe("Maximum number of drafts to return"),
      page_token: z.string().default("").describe("Page token for pagination"),
    }),
    execute: async ({ customer_id, max_results, page_token }) => {
      try {
        const data = await gmail.listDrafts(customer_id, max_results, page_token || undefined);
        return JSON.stringify({ success: true, ...data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });
}
