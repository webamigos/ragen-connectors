/**
 * Google Drive API service layer.
 */

import { googleGet, googleGetText } from "./google-api.js";

const BASE = "https://www.googleapis.com/drive/v3";

const EXPORT_MIME_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/xml",
  "application/json",
  "application/xml",
]);

const MIME_TYPE_ICONS: Record<string, string> = {
  "application/vnd.google-apps.document": "doc",
  "application/vnd.google-apps.spreadsheet": "sheet",
  "application/vnd.google-apps.presentation": "slide",
  "application/vnd.google-apps.folder": "folder",
  "application/pdf": "pdf",
};

export async function searchFiles(
  customerId: string,
  query = "",
  pageSize = 20,
  pageToken = "",
  mimeType = "",
): Promise<Record<string, unknown>> {
  const qParts = ["trashed = false"];
  if (mimeType) {
    const safeMimeType = mimeType.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    qParts.push(`mimeType = '${safeMimeType}'`);
  }
  if (query) {
    const safeQuery = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    qParts.push(`fullText contains '${safeQuery}'`);
  }

  const params: Record<string, string> = {
    q: qParts.join(" and "),
    pageSize: String(pageSize),
    fields:
      "nextPageToken, files(id, name, mimeType, modifiedTime, size, iconLink, webViewLink, owners)",
  };
  // Google Drive API does not allow orderBy with fullText queries
  if (!query) {
    params.orderBy = "modifiedByMeTime desc,viewedByMeTime desc";
  }
  if (pageToken) {
    params.pageToken = pageToken;
  }

  const data = await googleGet(customerId, `${BASE}/files`, params);

  const files = ((data.files ?? []) as Record<string, unknown>[]).map(formatFile);

  return {
    files,
    count: files.length,
    next_page_token: (data.nextPageToken as string) ?? "",
  };
}

export async function getFileContent(
  customerId: string,
  fileId: string,
): Promise<Record<string, unknown>> {
  const fileMeta = await googleGet(customerId, `${BASE}/files/${encodeURIComponent(fileId)}`, {
    fields: "id, name, mimeType, size",
  });

  const mimeType = (fileMeta.mimeType as string) ?? "";
  const name = (fileMeta.name as string) ?? "";

  // Google Workspace files: export as text
  if (mimeType in EXPORT_MIME_TYPES) {
    const exportMime = EXPORT_MIME_TYPES[mimeType]!;
    const content = await googleGetText(
      customerId,
      `${BASE}/files/${encodeURIComponent(fileId)}/export`,
      { mimeType: exportMime },
    );
    return { file_id: fileId, name, mime_type: mimeType, content };
  }

  // Regular text files: download directly
  if (TEXT_MIME_TYPES.has(mimeType)) {
    const content = await googleGetText(
      customerId,
      `${BASE}/files/${encodeURIComponent(fileId)}`,
      { alt: "media" },
    );
    return { file_id: fileId, name, mime_type: mimeType, content };
  }

  return {
    file_id: fileId,
    name,
    mime_type: mimeType,
    content: "",
    error: `Cannot extract text from files of type '${mimeType}'. Supported: Google Docs, Sheets, Slides, and plain text files.`,
  };
}

export async function getFileMetadata(
  customerId: string,
  fileId: string,
): Promise<Record<string, unknown>> {
  const f = await googleGet(customerId, `${BASE}/files/${encodeURIComponent(fileId)}`, {
    fields: "id, name, mimeType, modifiedTime, size, iconLink, webViewLink, owners",
  });
  return formatFile(f);
}

export async function listFolderFiles(
  customerId: string,
  folderId: string,
  pageSize = 50,
  pageToken = "",
): Promise<Record<string, unknown>> {
  const safeFolderId = folderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `'${safeFolderId}' in parents and trashed = false`;

  const params: Record<string, string> = {
    q,
    pageSize: String(pageSize),
    fields:
      "nextPageToken, files(id, name, mimeType, modifiedTime, size, iconLink, webViewLink, owners)",
    orderBy: "folder,modifiedTime desc",
  };
  if (pageToken) {
    params.pageToken = pageToken;
  }

  const data = await googleGet(customerId, `${BASE}/files`, params);

  const files = ((data.files ?? []) as Record<string, unknown>[]).map(formatFile);

  return {
    files,
    count: files.length,
    next_page_token: (data.nextPageToken as string) ?? "",
  };
}

export async function getFolderMetadata(
  customerId: string,
  folderId: string,
): Promise<Record<string, unknown>> {
  const f = await googleGet(customerId, `${BASE}/files/${encodeURIComponent(folderId)}`, {
    fields: "id, name, mimeType",
  });

  if (f.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error(
      `Item ${folderId} is not a folder (mimeType: ${f.mimeType ?? "unknown"})`,
    );
  }

  return { id: f.id ?? "", name: f.name ?? "", mime_type: f.mimeType ?? "" };
}

function formatFile(f: Record<string, unknown>): Record<string, unknown> {
  const mimeType = (f.mimeType as string) ?? "";
  const owners = (f.owners ?? []) as Record<string, unknown>[];

  return {
    id: f.id ?? "",
    name: f.name ?? "",
    mime_type: mimeType,
    icon: MIME_TYPE_ICONS[mimeType] ?? "file",
    modified_time: f.modifiedTime ?? "",
    size: f.size ?? null,
    web_view_link: f.webViewLink ?? "",
    icon_link: f.iconLink ?? "",
    owner: owners.length > 0 ? ((owners[0]!.displayName as string) ?? "") : "",
  };
}
