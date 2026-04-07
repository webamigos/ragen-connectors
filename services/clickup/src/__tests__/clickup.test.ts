import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../auth/token-store.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("clickup-token"),
}));

import {
  getWorkspaces,
  getSpaces,
  getFolders,
  getLists,
  getFolderlessLists,
  getTasks,
  getTask,
  createTask,
  updateTask,
} from "../services/clickup.js";

describe("clickup service", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getWorkspaces", () => {
    it("returns formatted workspaces", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            teams: [
              { id: "1", name: "Workspace 1", color: "#fff", members: [1, 2] },
              { id: "2", name: "Workspace 2" },
            ],
          }),
      });

      const result = await getWorkspaces("cust1");
      expect(result).toEqual([
        { id: "1", name: "Workspace 1", color: "#fff", members_count: 2 },
        { id: "2", name: "Workspace 2", color: "", members_count: 0 },
      ]);
    });
  });

  describe("getSpaces", () => {
    it("returns formatted spaces", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            spaces: [{ id: "s1", name: "Space 1", private: true, statuses: ["open"] }],
          }),
      });

      const result = await getSpaces("cust1", "w1");
      expect(result).toEqual([
        { id: "s1", name: "Space 1", private: true, status: ["open"] },
      ]);
      expect(mockFetch.mock.calls[0][0]).toContain("/team/w1/space");
    });
  });

  describe("getFolders", () => {
    it("returns formatted folders with list count", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            folders: [{ id: "f1", name: "Folder 1", lists: [1, 2, 3] }],
          }),
      });

      const result = await getFolders("cust1", "s1");
      expect(result).toEqual([{ id: "f1", name: "Folder 1", list_count: 3 }]);
    });
  });

  describe("getLists", () => {
    it("returns formatted lists", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            lists: [{ id: "l1", name: "List 1", task_count: 5, status: { status: "active" } }],
          }),
      });

      const result = await getLists("cust1", "f1");
      expect(result).toEqual([
        { id: "l1", name: "List 1", task_count: 5, status: { status: "active" } },
      ]);
    });
  });

  describe("getFolderlessLists", () => {
    it("returns formatted lists from space", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            lists: [{ id: "l2", name: "Folderless", task_count: 2 }],
          }),
      });

      const result = await getFolderlessLists("cust1", "s1");
      expect(result).toEqual([{ id: "l2", name: "Folderless", task_count: 2 }]);
    });
  });

  describe("getTasks", () => {
    it("returns formatted tasks with default options", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            tasks: [
              {
                id: "t1",
                name: "Task 1",
                description: "desc",
                status: { status: "open" },
                priority: { priority: "high" },
                assignees: [{ id: "u1", username: "user1", email: "u@e.com" }],
                due_date: "123456",
                url: "https://clickup.com/t1",
                date_created: "100",
                date_updated: "200",
                list: { id: "l1", name: "List 1" },
                tags: [{ name: "bug" }],
              },
            ],
          }),
      });

      const result = await getTasks("cust1", "l1");
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "t1",
        name: "Task 1",
        description: "desc",
        status: "open",
        priority: "high",
        assignees: [{ id: "u1", username: "user1", email: "u@e.com" }],
        due_date: "123456",
        url: "https://clickup.com/t1",
        date_created: "100",
        date_updated: "200",
        list: { id: "l1", name: "List 1" },
        tags: ["bug"],
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("page=0");
      expect(url).toContain("include_closed=false");
    });

    it("passes page and includeClosed options", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tasks: [] }),
      });

      await getTasks("cust1", "l1", { page: 2, includeClosed: true });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("page=2");
      expect(url).toContain("include_closed=true");
    });
  });

  describe("getTask", () => {
    it("fetches and formats single task", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "t2",
            name: "Single Task",
            description: "",
            status: "done",
            priority: null,
            assignees: [],
            tags: [],
          }),
      });

      const result = await getTask("cust1", "t2");
      expect(result.id).toBe("t2");
      expect(result.name).toBe("Single Task");
    });
  });

  describe("createTask", () => {
    it("sends POST with task body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "t3",
            name: "New Task",
            description: "some desc",
            status: { status: "open" },
            priority: { priority: "normal" },
            assignees: [],
            tags: [],
          }),
      });

      const result = await createTask("cust1", "l1", {
        name: "New Task",
        description: "some desc",
        priority: 2,
        tags: ["feature"],
      });

      expect(result.id).toBe("t3");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.name).toBe("New Task");
      expect(body.description).toBe("some desc");
      expect(body.priority).toBe(2);
      expect(body.tags).toEqual(["feature"]);
    });

    it("only sends provided optional fields", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "t4", name: "Minimal" }),
      });

      await createTask("cust1", "l1", { name: "Minimal" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({ name: "Minimal" });
      expect(body.description).toBeUndefined();
      expect(body.status).toBeUndefined();
    });
  });

  describe("updateTask", () => {
    it("sends PUT with updated fields", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "t1", name: "Updated", status: { status: "done" } }),
      });

      await updateTask("cust1", "t1", { name: "Updated", status: "done" });

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("/task/t1");
      expect(opts.method).toBe("PUT");
      const body = JSON.parse(opts.body);
      expect(body).toEqual({ name: "Updated", status: "done" });
    });
  });

  describe("error handling", () => {
    it("throws on non-ok GET response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await expect(getWorkspaces("cust1")).rejects.toThrow(
        "ClickUp API GET /team failed (404)",
      );
    });

    it("throws on non-ok POST response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(
        createTask("cust1", "l1", { name: "fail" }),
      ).rejects.toThrow("ClickUp API POST /list/l1/task failed (500)");
    });
  });
});
