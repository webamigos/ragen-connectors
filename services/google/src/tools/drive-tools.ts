/**
 * FastMCP tool definitions for Google Drive.
 */

import { FastMCP } from "fastmcp";
import { z } from "zod";
import * as drive from "../services/google-drive.js";

export function registerDriveTools(mcp: FastMCP): void {
  mcp.addTool({
    name: "search_drive_files",
    description:
      "Search for files in the user's Google Drive. Returns recent files if no query is provided.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      query: z.string().default("").describe("Search query to find files by name or content."),
      page_size: z.number().default(20).describe("Maximum number of files to return."),
      page_token: z.string().default("").describe("Pagination token from a previous response."),
      mime_type: z.string().default("").describe("Filter by MIME type."),
    }),
    execute: async ({ customer_id, query, page_size, page_token, mime_type }) => {
      try {
        const data = await drive.searchFiles(customer_id, query, page_size, page_token, mime_type);
        return JSON.stringify({ success: true, ...data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "read_drive_file",
    description:
      "Read the text content of a Google Drive file. Supports Google Docs, Sheets, Slides, and plain text files.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      file_id: z.string().describe("The Google Drive file ID to read"),
    }),
    execute: async ({ customer_id, file_id }) => {
      try {
        const data = await drive.getFileContent(customer_id, file_id);
        if (data.error) {
          return JSON.stringify({
            success: false,
            error: data.error,
            name: data.name,
            mime_type: data.mime_type,
          });
        }
        return JSON.stringify({ success: true, ...data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "get_drive_file_info",
    description:
      "Get metadata (name, type, size, link) for a Google Drive file without downloading its content.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      file_id: z.string().describe("The Google Drive file ID"),
    }),
    execute: async ({ customer_id, file_id }) => {
      try {
        const data = await drive.getFileMetadata(customer_id, file_id);
        return JSON.stringify({ success: true, file: data });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });

  mcp.addTool({
    name: "list_drive_folder_files",
    description:
      "List all files inside a Google Drive folder. Does not include sub-folders.",
    parameters: z.object({
      customer_id: z.string().describe("Customer identifier"),
      folder_id: z.string().describe("The Google Drive folder ID"),
      page_size: z.number().default(50).describe("Maximum number of files to return."),
      page_token: z.string().default("").describe("Pagination token from a previous response."),
    }),
    execute: async ({ customer_id, folder_id, page_size, page_token }) => {
      try {
        const [folderMeta, filesData] = await Promise.all([
          drive.getFolderMetadata(customer_id, folder_id),
          drive.listFolderFiles(customer_id, folder_id, page_size, page_token),
        ]);
        return JSON.stringify({ success: true, folder_name: folderMeta.name, ...filesData });
      } catch (e) { return JSON.stringify({ success: false, error: String(e) }); }
    },
  });
}
