/**
 * FastMCP tool definitions for ClickUp.
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import * as clickup from "../services/clickup.js";

export function registerClickupTools(mcp: FastMCP): void {
  mcp.addTool({
    name: "get_workspaces",
    description: "List all ClickUp workspaces (teams) the user belongs to.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
    }),
    execute: async ({ customer_id }) => {
      try {
        const workspaces = await clickup.getWorkspaces(customer_id);
        return JSON.stringify({ success: true, workspaces, count: workspaces.length });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  });

  mcp.addTool({
    name: "get_spaces",
    description: "List all spaces in a ClickUp workspace.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      workspace_id: z.string().describe("The ClickUp workspace (team) ID"),
    }),
    execute: async ({ customer_id, workspace_id }) => {
      try {
        const spaces = await clickup.getSpaces(customer_id, workspace_id);
        return JSON.stringify({ success: true, spaces, count: spaces.length });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  });

  mcp.addTool({
    name: "get_folders",
    description: "List all folders in a ClickUp space.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      space_id: z.string().describe("The ClickUp space ID"),
    }),
    execute: async ({ customer_id, space_id }) => {
      try {
        const folders = await clickup.getFolders(customer_id, space_id);
        return JSON.stringify({ success: true, folders, count: folders.length });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  });

  mcp.addTool({
    name: "get_lists",
    description: "List all lists in a ClickUp folder.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      folder_id: z.string().describe("The ClickUp folder ID"),
    }),
    execute: async ({ customer_id, folder_id }) => {
      try {
        const lists = await clickup.getLists(customer_id, folder_id);
        return JSON.stringify({ success: true, lists, count: lists.length });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  });

  mcp.addTool({
    name: "get_folderless_lists",
    description: "List all lists in a ClickUp space that are not inside a folder.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      space_id: z.string().describe("The ClickUp space ID"),
    }),
    execute: async ({ customer_id, space_id }) => {
      try {
        const lists = await clickup.getFolderlessLists(customer_id, space_id);
        return JSON.stringify({ success: true, lists, count: lists.length });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  });

  mcp.addTool({
    name: "get_tasks",
    description: "Get tasks from a ClickUp list.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      list_id: z.string().describe("The ClickUp list ID"),
      page: z.number().default(0).describe("Page number for pagination (starts at 0)"),
      include_closed: z.boolean().default(false).describe("Whether to include closed tasks"),
    }),
    execute: async ({ customer_id, list_id, page, include_closed }) => {
      try {
        const tasks = await clickup.getTasks(customer_id, list_id, {
          page,
          includeClosed: include_closed,
        });
        return JSON.stringify({ success: true, tasks, count: tasks.length });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  });

  mcp.addTool({
    name: "get_task",
    description: "Get details of a specific ClickUp task.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      task_id: z.string().describe("The ClickUp task ID"),
    }),
    execute: async ({ customer_id, task_id }) => {
      try {
        const task = await clickup.getTask(customer_id, task_id);
        return JSON.stringify({ success: true, task });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  });

  mcp.addTool({
    name: "create_task",
    description: "Create a new task in a ClickUp list.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      list_id: z.string().describe("The ClickUp list ID to create the task in"),
      name: z.string().describe("Task name"),
      description: z.string().default("").describe("Task description (supports markdown)"),
      status: z.string().optional().describe("Task status (must match a status in the list)"),
      priority: z.number().optional().describe("Priority level (1=urgent, 2=high, 3=normal, 4=low)"),
      assignees: z.array(z.number()).optional().describe("List of ClickUp user IDs to assign"),
      due_date: z.number().optional().describe("Due date as Unix timestamp in milliseconds"),
      tags: z.array(z.string()).optional().describe("List of tag names to apply"),
    }),
    execute: async ({ customer_id, list_id, name, description, status, priority, assignees, due_date, tags }) => {
      try {
        const task = await clickup.createTask(customer_id, list_id, {
          name,
          description,
          status,
          priority,
          assignees,
          dueDate: due_date,
          tags,
        });
        return JSON.stringify({ success: true, task });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  });

  mcp.addTool({
    name: "update_task",
    description: "Update an existing ClickUp task.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      task_id: z.string().describe("The ClickUp task ID to update"),
      name: z.string().optional().describe("New task name"),
      description: z.string().optional().describe("New task description"),
      status: z.string().optional().describe("New task status"),
      priority: z.number().optional().describe("New priority level (1=urgent, 2=high, 3=normal, 4=low)"),
      due_date: z.number().optional().describe("New due date as Unix timestamp in milliseconds"),
    }),
    execute: async ({ customer_id, task_id, name, description, status, priority, due_date }) => {
      try {
        const task = await clickup.updateTask(customer_id, task_id, {
          name,
          description,
          status,
          priority,
          dueDate: due_date,
        });
        return JSON.stringify({ success: true, task });
      } catch (e) {
        return JSON.stringify({ success: false, error: String(e) });
      }
    },
  });
}
