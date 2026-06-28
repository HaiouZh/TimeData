import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

function seedTask(overrides: Partial<{
  id: string;
  parentId: string | null;
  title: string;
  done: number;
  recurrence: string | null;
  lastDoneAt: string | null;
  startAt: string | null;
  scheduledAt: string | null;
  weight: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}> = {}): string {
  const id = overrides.id ?? `t-${Math.random().toString(36).slice(2)}`;
  const timestamp = overrides.createdAt ?? "2026-06-14T00:00:00.000Z";
  db.prepare(`
    INSERT INTO tasks (id, parent_id, title, done, recurrence, last_done_at, start_at, scheduled_at, sort_order, weight, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.parentId ?? null,
    overrides.title ?? id,
    overrides.done ?? 0,
    overrides.recurrence ?? null,
    overrides.lastDoneAt ?? null,
    overrides.startAt ?? null,
    overrides.scheduledAt ?? null,
    overrides.sortOrder ?? 0,
    overrides.weight ?? 0,
    timestamp,
    overrides.updatedAt ?? timestamp,
  );
  return id;
}

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/tasks", "../routes/tasks.js");
  app = setup.app;
  db = setup.db;
  // 清空默认数据，手动播种
  db.prepare("DELETE FROM tasks").run();
  seedTask({ id: "t1", title: "池任务", done: 0, sortOrder: 0 });
  seedTask({
    id: "t2",
    title: "周跑",
    done: 0,
    recurrence: JSON.stringify({ freq: "weekly", interval: 1, byWeekday: [1], basis: "due" }),
    sortOrder: 1,
  });
  seedTask({ id: "t3", title: "完成项", done: 1, sortOrder: 2 });
  seedTask({ id: "child-1", parentId: "t1", title: "子任务", done: 0, sortOrder: 3 });
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

describe("GET /api/tasks (read-only)", () => {
  it("returns only root tasks", async () => {
    const res = await app.request("/api/tasks");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("filters kind=recurring", async () => {
    const res = await app.request("/api/tasks?kind=recurring");
    const body = await res.json();

    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(["t2"]);
  });

  it("filters kind=pool", async () => {
    const res = await app.request("/api/tasks?kind=pool");
    const body = await res.json();

    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(["t1", "t3"]);
  });

  it("filters done status within root tasks only", async () => {
    const res = await app.request("/api/tasks?done=0");
    const body = await res.json();

    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(["t1", "t2"]);
  });

  it("filters done status", async () => {
    const res = await app.request("/api/tasks?done=1");
    const body = await res.json();

    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(["t3"]);
  });

  it("rejects unknown query parameters", async () => {
    const res = await app.request("/api/tasks?write=1");

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });
});

describe("POST /api/tasks/:id/schedule", () => {
  it("设置日期写 scheduled_at 并记 seq", async () => {
    const res = await app.request("/api/tasks/t1/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: "2026-06-15" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.task.id).toBe("t1");
    expect(body.task.scheduledAt).toBeTruthy();
    // 验证 scheduled_at 是一个 ISO 字符串（具体值取决于进程时区）
    expect(body.task.scheduledAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // 验证 updatedAt 已更新
    expect(body.task.updatedAt).not.toBe("2026-06-14T00:00:00.000Z");

    // 验证 sync_seq 记录
    const seqRow = db.prepare("SELECT * FROM sync_seq WHERE table_name = 'tasks' AND record_id = 't1' ORDER BY id DESC LIMIT 1").get() as { action: string } | undefined;
    expect(seqRow).toBeDefined();
    expect(seqRow!.action).toBe("update");
  });

  it("scheduledDate=null 清排期", async () => {
    // 先排期
    await app.request("/api/tasks/t1/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: "2026-06-15" }),
    });

    // 再清除
    const res = await app.request("/api/tasks/t1/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: null }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.task.scheduledAt).toBeNull();
  });

  it("保留任务 weight，不因排期或清排期被重置", async () => {
    seedTask({ id: "weighted", title: "高水位任务", weight: 7 });

    const scheduled = await app.request("/api/tasks/weighted/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: "2026-06-15" }),
    });
    const scheduledBody = await scheduled.json();
    expect(scheduledBody.task.weight).toBe(7);

    const cleared = await app.request("/api/tasks/weighted/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: null }),
    });
    const clearedBody = await cleared.json();

    expect(clearedBody.task.scheduledAt).toBeNull();
    expect(clearedBody.task.weight).toBe(7);
    expect(db.prepare("SELECT weight FROM tasks WHERE id = ?").get("weighted")).toEqual({ weight: 7 });
  });

  it("非法日期 → 400 INVALID_REQUEST", async () => {
    const res = await app.request("/api/tasks/t1/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: "not-a-date" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });

  it("任务不存在 → 404 NOT_FOUND", async () => {
    const res = await app.request("/api/tasks/nonexistent/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: "2026-06-15" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("重复任务 → 409 TASK_RECURRING_USE_RULE", async () => {
    const res = await app.request("/api/tasks/t2/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: "2026-06-15" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "TASK_RECURRING_USE_RULE" } });
  });
});
