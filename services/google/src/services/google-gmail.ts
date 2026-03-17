/**
 * Google Gmail API service layer (read-only).
 */

import { googleGet } from "./google-api.js";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function getProfile(
  customerId: string,
): Promise<Record<string, unknown>> {
  const data = await googleGet(customerId, `${BASE}/profile`);
  return {
    email_address: data.emailAddress ?? "",
    messages_total: data.messagesTotal ?? 0,
    threads_total: data.threadsTotal ?? 0,
    history_id: data.historyId ?? "",
  };
}

export async function listLabels(
  customerId: string,
): Promise<Record<string, unknown>[]> {
  const data = await googleGet(customerId, `${BASE}/labels`);
  return ((data.labels ?? []) as Record<string, unknown>[]).map((label) => ({
    id: label.id,
    name: label.name,
    type: label.type,
    message_list_visibility: label.messageListVisibility ?? "",
    label_list_visibility: label.labelListVisibility ?? "",
  }));
}

export async function searchMessages(
  customerId: string,
  query: string,
  maxResults = 10,
  pageToken?: string,
  labelIds?: string[],
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    maxResults: String(maxResults),
  };
  if (query) {
    params.q = query;
  }
  if (pageToken) {
    params.pageToken = pageToken;
  }
  if (labelIds?.length) {
    params.labelIds = labelIds.join(",");
  }

  const data = await googleGet(customerId, `${BASE}/messages`, params);

  const messages = (data.messages ?? []) as Record<string, unknown>[];
  return {
    messages: messages.map((m) => ({
      id: m.id,
      thread_id: m.threadId,
    })),
    result_size_estimate: data.resultSizeEstimate ?? 0,
    next_page_token: data.nextPageToken ?? null,
  };
}

export async function readMessage(
  customerId: string,
  messageId: string,
  format: "full" | "metadata" | "minimal" = "full",
): Promise<Record<string, unknown>> {
  const data = await googleGet(
    customerId,
    `${BASE}/messages/${encodeURIComponent(messageId)}`,
    { format },
  );
  return formatMessage(data);
}

export async function readThread(
  customerId: string,
  threadId: string,
  format: "full" | "metadata" | "minimal" = "full",
): Promise<Record<string, unknown>> {
  const data = await googleGet(
    customerId,
    `${BASE}/threads/${encodeURIComponent(threadId)}`,
    { format },
  );

  const messages = ((data.messages ?? []) as Record<string, unknown>[]).map(formatMessage);
  return {
    id: data.id,
    messages,
    message_count: messages.length,
  };
}

export async function listDrafts(
  customerId: string,
  maxResults = 10,
  pageToken?: string,
): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    maxResults: String(maxResults),
  };
  if (pageToken) {
    params.pageToken = pageToken;
  }

  const data = await googleGet(customerId, `${BASE}/drafts`, params);

  const drafts = ((data.drafts ?? []) as Record<string, unknown>[]).map((d) => ({
    id: d.id,
    message_id: ((d.message ?? {}) as Record<string, unknown>).id ?? "",
    thread_id: ((d.message ?? {}) as Record<string, unknown>).threadId ?? "",
  }));

  return {
    drafts,
    result_size_estimate: data.resultSizeEstimate ?? 0,
    next_page_token: data.nextPageToken ?? null,
  };
}

function formatMessage(msg: Record<string, unknown>): Record<string, unknown> {
  const payload = (msg.payload ?? {}) as Record<string, unknown>;
  const headers = (payload.headers ?? []) as Record<string, string>[];

  const getHeader = (name: string): string => {
    const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
    return found?.value ?? "";
  };

  const formatted: Record<string, unknown> = {
    id: msg.id ?? "",
    thread_id: msg.threadId ?? "",
    label_ids: msg.labelIds ?? [],
    snippet: msg.snippet ?? "",
    internal_date: msg.internalDate ?? "",
    from: getHeader("From"),
    to: getHeader("To"),
    cc: getHeader("Cc"),
    bcc: getHeader("Bcc"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
  };

  const body = extractBody(payload);
  if (body) {
    formatted.body = body;
  }

  return formatted;
}

function extractBody(payload: Record<string, unknown>): string {
  const body = (payload.body ?? {}) as Record<string, unknown>;
  if (body.data) {
    return Buffer.from(body.data as string, "base64url").toString("utf-8");
  }

  const parts = (payload.parts ?? []) as Record<string, unknown>[];
  for (const part of parts) {
    const mimeType = part.mimeType as string;
    if (mimeType === "text/plain") {
      const partBody = (part.body ?? {}) as Record<string, unknown>;
      if (partBody.data) {
        return Buffer.from(partBody.data as string, "base64url").toString("utf-8");
      }
    }
  }

  // Check nested multipart
  for (const part of parts) {
    const nested = extractBody(part);
    if (nested) {
      return nested;
    }
  }

  return "";
}
