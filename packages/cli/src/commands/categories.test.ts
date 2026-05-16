import { describe, expect, it, vi } from "vitest";
import { runCategories } from "./categories.js";

describe("runCategories", () => {
  it("returns active category paths", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { id: "parent-1", name: "工作", parentId: null, isArchived: false },
      { id: "child-1", name: "编程", parentId: "parent-1", isArchived: false },
      { id: "archived-1", name: "旧分类", parentId: null, isArchived: true },
    ]), { status: 200 }));

    await expect(runCategories({ serverUrl: "https://server.example", token: "secret" }, fetchImpl)).resolves.toEqual({
      ok: true,
      categories: [
        { id: "parent-1", path: "工作", name: "工作", parentId: null },
        { id: "child-1", path: "工作/编程", name: "编程", parentId: "parent-1" },
      ],
    });
  });

  it("passes API errors through unchanged", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } }), { status: 401 }));

    await expect(runCategories({ serverUrl: "https://server.example", token: "bad" }, fetchImpl)).resolves.toEqual({
      ok: false,
      error: { code: "AUTH_FAILED", message: "Authentication failed" },
    });
  });
});
