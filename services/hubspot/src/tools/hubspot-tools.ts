/**
 * FastMCP tool definitions for HubSpot (readonly).
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import * as hubspot from "../services/hubspot.js";

export function registerHubspotTools(mcp: FastMCP): void {
  mcp.addTool({
    name: "get_contacts",
    description: "List HubSpot contacts with pagination.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      limit: z.number().default(10).describe("Number of contacts to return (max 100)"),
      after: z.string().optional().describe("Cursor for pagination"),
      properties: z.array(z.string()).optional().describe("Property names to include"),
    }),
    execute: async ({ customer_id, limit, after, properties }) => {
      try {
        const result = await hubspot.getContacts(customer_id, limit, after, properties);
        return JSON.stringify({ success: true, ...result });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_contact",
    description: "Get a single HubSpot contact by ID.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      contact_id: z.string().describe("The HubSpot contact ID"),
      properties: z.array(z.string()).optional().describe("Property names to include"),
    }),
    execute: async ({ customer_id, contact_id, properties }) => {
      try {
        const contact = await hubspot.getContact(customer_id, contact_id, properties);
        return JSON.stringify({ success: true, contact });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_companies",
    description: "List HubSpot companies with pagination.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      limit: z.number().default(10).describe("Number of companies to return (max 100)"),
      after: z.string().optional().describe("Cursor for pagination"),
      properties: z.array(z.string()).optional().describe("Property names to include"),
    }),
    execute: async ({ customer_id, limit, after, properties }) => {
      try {
        const result = await hubspot.getCompanies(customer_id, limit, after, properties);
        return JSON.stringify({ success: true, ...result });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_company",
    description: "Get a single HubSpot company by ID.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      company_id: z.string().describe("The HubSpot company ID"),
      properties: z.array(z.string()).optional().describe("Property names to include"),
    }),
    execute: async ({ customer_id, company_id, properties }) => {
      try {
        const company = await hubspot.getCompany(customer_id, company_id, properties);
        return JSON.stringify({ success: true, company });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_deals",
    description: "List HubSpot deals with pagination.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      limit: z.number().default(10).describe("Number of deals to return (max 100)"),
      after: z.string().optional().describe("Cursor for pagination"),
      properties: z.array(z.string()).optional().describe("Property names to include"),
    }),
    execute: async ({ customer_id, limit, after, properties }) => {
      try {
        const result = await hubspot.getDeals(customer_id, limit, after, properties);
        return JSON.stringify({ success: true, ...result });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_deal",
    description: "Get a single HubSpot deal by ID.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      deal_id: z.string().describe("The HubSpot deal ID"),
      properties: z.array(z.string()).optional().describe("Property names to include"),
    }),
    execute: async ({ customer_id, deal_id, properties }) => {
      try {
        const deal = await hubspot.getDeal(customer_id, deal_id, properties);
        return JSON.stringify({ success: true, deal });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_tickets",
    description: "List HubSpot tickets with pagination.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      limit: z.number().default(10).describe("Number of tickets to return (max 100)"),
      after: z.string().optional().describe("Cursor for pagination"),
      properties: z.array(z.string()).optional().describe("Property names to include"),
    }),
    execute: async ({ customer_id, limit, after, properties }) => {
      try {
        const result = await hubspot.getTickets(customer_id, limit, after, properties);
        return JSON.stringify({ success: true, ...result });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_ticket",
    description: "Get a single HubSpot ticket by ID.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      ticket_id: z.string().describe("The HubSpot ticket ID"),
      properties: z.array(z.string()).optional().describe("Property names to include"),
    }),
    execute: async ({ customer_id, ticket_id, properties }) => {
      try {
        const ticket = await hubspot.getTicket(customer_id, ticket_id, properties);
        return JSON.stringify({ success: true, ticket });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "search_crm_objects",
    description: "Search HubSpot CRM objects with filters and free-text query.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      object_type: z.string().describe("Type of object: contacts, companies, deals, or tickets"),
      query: z.string().default("").describe("Free-text search query"),
      filters: z.array(z.record(z.unknown())).optional().describe("Filter objects with propertyName, operator, value"),
      properties: z.array(z.string()).optional().describe("Property names to return"),
      limit: z.number().default(10).describe("Max results (up to 100)"),
      after: z.number().default(0).describe("Offset for pagination"),
    }),
    execute: async ({ customer_id, object_type, query, filters, properties, limit, after }) => {
      try {
        const result = await hubspot.searchObjects(customer_id, object_type, query, filters, properties, limit, after);
        return JSON.stringify({ success: true, ...result });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_pipelines",
    description: "Get HubSpot pipelines and their stages.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      object_type: z.string().default("deals").describe("Pipeline object type: deals or tickets"),
    }),
    execute: async ({ customer_id, object_type }) => {
      try {
        const pipelines = await hubspot.getPipelines(customer_id, object_type);
        return JSON.stringify({ success: true, pipelines, count: pipelines.length });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_owners",
    description: "List HubSpot owners (users/team members).",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      limit: z.number().default(100).describe("Number of owners to return (max 100)"),
      after: z.string().optional().describe("Cursor for pagination"),
    }),
    execute: async ({ customer_id, limit, after }) => {
      try {
        const result = await hubspot.getOwners(customer_id, limit, after);
        return JSON.stringify({ success: true, ...result });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_associations",
    description: "Get associations between HubSpot objects.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      from_object_type: z.string().describe("Source object type"),
      from_object_id: z.string().describe("Source object ID"),
      to_object_type: z.string().describe("Target object type"),
    }),
    execute: async ({ customer_id, from_object_type, from_object_id, to_object_type }) => {
      try {
        const associations = await hubspot.getAssociations(customer_id, from_object_type, from_object_id, to_object_type);
        return JSON.stringify({ success: true, associations, count: associations.length });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_object_properties",
    description: "Get all available properties for a HubSpot object type.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      object_type: z.string().describe("Object type (contacts, companies, deals, tickets)"),
    }),
    execute: async ({ customer_id, object_type }) => {
      try {
        const properties = await hubspot.getProperties(customer_id, object_type);
        return JSON.stringify({ success: true, properties, count: properties.length });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });
}
