import { describe, expect, it, vi } from "vitest";
import { runCategories } from "./categories.js";

const config = { serverUrl: "http://localhost:3000", token: "test" };

describe("runCategories schema 校验", () => {
  it("正常响应通过 schema，输出 categories", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      {
        id: "c1", name: "X", parentId: null, color: "#ffffff", icon: null,
        sortOrder: 0, isArchived: false,
        createdAt: "2026-05-19T03:00:00.000Z", updatedAt: "2026-05-19T03:00:00.000Z",
      },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await runCategories(config, fetchImpl as unknown as typeof fetch) as { ok: true; categories: Array<{ id: string; path: string; name: string; parentId: string | null }> };
    expect(result.ok).toBe(true);
    expect(result.categories).toHaveLength(1);
  });

  it("响应缺字段时返回 SCHEMA_MISMATCH 而非 silently 失败", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { id: "c1", name: "X" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await runCategories(config, fetchImpl as unknown as typeof fetch) as { ok: false; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SCHEMA_MISMATCH");
  });
});

describe("runCategories", () => {
  it("returns active category paths", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { id: "parent-1", name: "工作", parentId: null, isArchived: false, color: "#ffffff", icon: null, sortOrder: 0, createdAt: "2026-05-19T00:00:00.000Z", updatedAt: "2026-05-19T00:00:00.000Z" },
      { id: "child-1", name: "编程", parentId: "parent-1", isArchived: false, color: "#ffffff", icon: null, sortOrder: 1, createdAt: "2026-05-19T00:00:00.000Z", updatedAt: "2026-05-19T00:00:00.000Z" },
      { id: "archived-1", name: "旧分类", parentId: null, isArchived: true, color: "#ffffff", icon: null, sortOrder: 2, createdAt: "2026-05-19T00:00:00.000Z", updatedAt: "2026-05-19T00:00:00.000Z" },
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
