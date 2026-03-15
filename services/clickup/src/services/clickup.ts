/**
 * ClickUp API service layer.
 */

import { getAccessToken } from "../auth/token-store.js";

const BASE_URL = "https://api.clickup.com/api/v2";
const TIMEOUT_MS = 30_000;

async function headers(customerId: string): Promise<Record<string, string>> {
  const token = await getAccessToken(customerId);
  return { Authorization: token, "Content-Type": "application/json" };
}

async function get(
  customerId: string,
  path: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>> {
  let url = `${BASE_URL}${path}`;
  if (params) {
    url += `?${new URLSearchParams(params).toString()}`;
  }
  const resp = await fetch(url, {
    headers: await headers(customerId),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`ClickUp API GET ${path} failed (${resp.status})`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

async function post(
  customerId: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: await headers(customerId),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`ClickUp API POST ${path} failed (${resp.status})`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

async function put(
  customerId: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers: await headers(customerId),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`ClickUp API PUT ${path} failed (${resp.status})`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

// --- Workspaces ---

export async function getWorkspaces(
  customerId: string,
): Promise<Record<string, unknown>[]> {
  const data = await get(customerId, "/team");
  const teams = (data.teams ?? []) as Record<string, unknown>[];
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color ?? "",
    members_count: Array.isArray(t.members) ? t.members.length : 0,
  }));
}

// --- Spaces ---

export async function getSpaces(
  customerId: string,
  workspaceId: string,
): Promise<Record<string, unknown>[]> {
  const data = await get(customerId, `/team/${workspaceId}/space`);
  const spaces = (data.spaces ?? []) as Record<string, unknown>[];
  return spaces.map((s) => ({
    id: s.id,
    name: s.name,
    private: s.private ?? false,
    status: s.statuses ?? [],
  }));
}

// --- Folders ---

export async function getFolders(
  customerId: string,
  spaceId: string,
): Promise<Record<string, unknown>[]> {
  const data = await get(customerId, `/space/${spaceId}/folder`);
  const folders = (data.folders ?? []) as Record<string, unknown>[];
  return folders.map((f) => ({
    id: f.id,
    name: f.name,
    list_count: Array.isArray(f.lists) ? f.lists.length : 0,
  }));
}

// --- Lists ---

export async function getLists(
  customerId: string,
  folderId: string,
): Promise<Record<string, unknown>[]> {
  const data = await get(customerId, `/folder/${folderId}/list`);
  const lists = (data.lists ?? []) as Record<string, unknown>[];
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    task_count: l.task_count ?? 0,
    status: l.status ?? {},
  }));
}

export async function getFolderlessLists(
  customerId: string,
  spaceId: string,
): Promise<Record<string, unknown>[]> {
  const data = await get(customerId, `/space/${spaceId}/list`);
  const lists = (data.lists ?? []) as Record<string, unknown>[];
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    task_count: l.task_count ?? 0,
  }));
}

// --- Tasks ---

interface GetTasksOptions {
  page?: number;
  includeClosed?: boolean;
}

export async function getTasks(
  customerId: string,
  listId: string,
  options?: GetTasksOptions,
): Promise<Record<string, unknown>[]> {
  const params: Record<string, string> = {
    page: String(options?.page ?? 0),
    include_closed: String(options?.includeClosed ?? false),
  };
  const data = await get(customerId, `/list/${listId}/task`, params);
  const tasks = (data.tasks ?? []) as Record<string, unknown>[];
  return tasks.map(formatTask);
}

export async function getTask(
  customerId: string,
  taskId: string,
): Promise<Record<string, unknown>> {
  const data = await get(customerId, `/task/${taskId}`);
  return formatTask(data);
}

interface CreateTaskOptions {
  name: string;
  description?: string;
  status?: string;
  priority?: number;
  assignees?: number[];
  dueDate?: number;
  tags?: string[];
}

export async function createTask(
  customerId: string,
  listId: string,
  options: CreateTaskOptions,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { name: options.name };
  if (options.description) body.description = options.description;
  if (options.status) body.status = options.status;
  if (options.priority != null) body.priority = options.priority;
  if (options.assignees) body.assignees = options.assignees;
  if (options.dueDate != null) body.due_date = options.dueDate;
  if (options.tags) body.tags = options.tags;

  const data = await post(customerId, `/list/${listId}/task`, body);
  return formatTask(data);
}

interface UpdateTaskOptions {
  name?: string;
  description?: string;
  status?: string;
  priority?: number;
  dueDate?: number;
}

export async function updateTask(
  customerId: string,
  taskId: string,
  options: UpdateTaskOptions,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (options.name != null) body.name = options.name;
  if (options.description != null) body.description = options.description;
  if (options.status != null) body.status = options.status;
  if (options.priority != null) body.priority = options.priority;
  if (options.dueDate != null) body.due_date = options.dueDate;

  const data = await put(customerId, `/task/${taskId}`, body);
  return formatTask(data);
}

// --- Helpers ---

function formatTask(task: Record<string, unknown>): Record<string, unknown> {
  const status = task.status as Record<string, unknown> | undefined;
  const priority = task.priority as Record<string, unknown> | undefined;
  const list = task.list as Record<string, unknown> | undefined;
  const assignees = (task.assignees ?? []) as Record<string, unknown>[];
  const tags = (task.tags ?? []) as Record<string, unknown>[];

  return {
    id: task.id ?? "",
    name: task.name ?? "",
    description: task.description ?? "",
    status:
      typeof task.status === "object" && status
        ? status.status ?? ""
        : task.status ?? "",
    priority:
      typeof task.priority === "object" && priority
        ? priority.priority ?? ""
        : task.priority,
    assignees: assignees.map((a) => ({
      id: a.id ?? "",
      username: a.username ?? "",
      email: a.email ?? "",
    })),
    due_date: task.due_date ?? "",
    url: task.url ?? "",
    date_created: task.date_created ?? "",
    date_updated: task.date_updated ?? "",
    list: { id: list?.id ?? "", name: list?.name ?? "" },
    tags: tags.map((t) => (t.name as string) ?? ""),
  };
}
