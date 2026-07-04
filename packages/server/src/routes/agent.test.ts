import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

function seedTask(id = "task-1"): void {
  db.prepare(`
    INSERT INTO tasks (id, parent_id, title, done, recurrence, last_done_at, start_at, sort_order, scheduled_at, completed_count, completed_at, tags, created_at, updated_at)
    VALUES (?, NULL, ?, 0, NULL, NULL, NULL, 0, NULL, 0, NULL, '[]', ?, ?)
  `).run(id, "想法", "2026-06-16T00:00:00.000Z", "2026-06-16T00:00:00.000Z");
}

function seedRecurring(id = "rec-1", recurrence = '{"freq":"daily","interval":1,"basis":"due"}'): void {
  db.prepare(`
    INSERT INTO tasks (id, parent_id, title, done, recurrence, last_done_at, start_at, sort_order, scheduled_at, completed_count, completed_at, tags, created_at, updated_at)
    VALUES (?, NULL, ?, 0, ?, NULL, ?, 0, NULL, 0, NULL, '[]', ?, ?)
  `).run(
    id,
    "跑步",
    recurrence,
    "2026-06-01T00:00:00.000Z",
    "2026-06-01T00:00:00.000Z",
    "2026-06-01T00:00:00.000Z",
  );
}

function seedChild(overrides: {
  id: string;
  parentId: string;
  title: string;
  done?: boolean;
  completedAt?: string | null;
  sortOrder?: number;
}): void {
  db.prepare(`
    INSERT INTO tasks (id, parent_id, title, done, recurrence, last_done_at, start_at, sort_order, scheduled_at, completed_count, completed_at, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, 0, ?, '[]', ?, ?)
  `).run(
    overrides.id,
    overrides.parentId,
    overrides.title,
    overrides.done ? 1 : 0,
    overrides.sortOrder ?? 0,
    overrides.completedAt ?? null,
    "2026-06-16T00:00:00.000Z",
    "2026-06-16T00:00:00.000Z",
  );
}

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/agent", "../routes/agent.js");
  app = setup.app;
  db = setup.db;
  db.prepare("DELETE FROM tasks").run();
  seedTask();
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

describe("POST /api/agent/tasks/:id/status", () => {
  it("creates note child, records seq and notifies listeners", async () => {
    const { addSyncStreamListener, removeSyncStreamListener } = await import("../sync/notifier.js");
    const seen: Array<number | null> = [];
    const listener = (seq: number | null) => seen.push(seq);
    addSyncStreamListener(listener);

    try {
      db.prepare("UPDATE tasks SET weight = ? WHERE id = ?").run(4, "task-1");

      const res = await app.request("/api/agent/tasks/task-1/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "done PR#123" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        task: { id: string; weight: number };
      };
      expect(body.ok).toBe(true);
      expect(body.task.weight).toBe(4);

      const child = db.prepare("SELECT id, parent_id, title, done, weight FROM tasks WHERE parent_id = ?").get("task-1") as {
        id: string;
        parent_id: string;
        title: string;
        done: number;
        weight: number;
      };
      expect(child).toMatchObject({ parent_id: "task-1", title: "done PR#123", done: 0, weight: 0 });
      expect(db.prepare("SELECT weight FROM tasks WHERE id = ?").get("task-1")).toEqual({ weight: 4 });
      expect(db.prepare("SELECT table_name, record_id, action FROM sync_seq ORDER BY id").all()).toEqual(
        expect.arrayContaining([
          { table_name: "tasks", record_id: child.id, action: "create" },
          { table_name: "tasks", record_id: "task-1", action: "update" },
        ]),
      );
      expect(seen.at(-1)).toBeGreaterThan(0);
    } finally {
      removeSyncStreamListener(listener);
    }
  });

  it("done=true 普通任务：写 completedAt", async () => {
    db.prepare("UPDATE tasks SET weight = ? WHERE id = ?").run(5, "task-1");

    const res = await app.request("/api/agent/tasks/task-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });

    expect(res.status).toBe(200);
    const row = db.prepare("SELECT done, completed_at, weight FROM tasks WHERE id = ?").get("task-1") as {
      done: number;
      completed_at: string | null;
      weight: number;
    };
    expect(row.done).toBe(1);
    expect(row.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.weight).toBe(5);
  });

  it("done=true 重复模板：代理完成「最新那一发」，模板本体不动（§9.2）", async () => {
    seedRecurring();
    const before = (db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
    const res = await app.request("/api/agent/tasks/rec-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });

    expect(res.status).toBe(200);
    const tpl = db.prepare("SELECT done, recurrence, completed_count, last_done_at FROM tasks WHERE id = ?").get("rec-1") as {
      done: number;
      recurrence: string | null;
      completed_count: number;
      last_done_at: string | null;
    };
    // 模板不承载完成态：done/游标字段全不动
    expect(tpl).toMatchObject({ done: 0, completed_count: 0, last_done_at: null });
    expect(tpl.recurrence).not.toBeNull();
    const after = (db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
    expect(after).toBe(before + 1);
    // 无 active → 先按引擎物化再完成：确定性 id occurrence（引擎可见），非随机 uuid 游离行
    const occ = db.prepare("SELECT id, rule_id, done, recurrence, completed_at FROM tasks WHERE rule_id = ?").get("rec-1") as {
      id: string;
      rule_id: string;
      done: number;
      recurrence: string | null;
      completed_at: string | null;
    };
    expect(occ.id.startsWith("occ:rec-1:")).toBe(true);
    expect(occ).toMatchObject({ rule_id: "rec-1", done: 1, recurrence: null });
    expect(occ.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(db.prepare("SELECT record_id, action FROM sync_seq WHERE table_name = 'tasks' ORDER BY id").all()).toEqual(
      expect.arrayContaining([{ record_id: occ.id, action: "create" }]),
    );
  });

  it("done=true 重复模板带 children：模板 children 原样不动，完成只落在 occurrence 上", async () => {
    seedRecurring("rec-with-children");
    seedChild({
      id: "child-done",
      parentId: "rec-with-children",
      title: "已完成子项",
      done: true,
      completedAt: "2026-06-16T01:00:00.000Z",
      sortOrder: 0,
    });
    seedChild({ id: "child-open", parentId: "rec-with-children", title: "未完成子项", sortOrder: 1 });

    const res = await app.request("/api/agent/tasks/rec-with-children/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });

    expect(res.status).toBe(200);
    const occurrence = db.prepare("SELECT id, done FROM tasks WHERE rule_id = ?").get("rec-with-children") as {
      id: string;
      done: number;
    };
    expect(occurrence).toMatchObject({ done: 1 });

    // server 侧代理只写 occurrence 本体；children 由 client 物化引擎按模板补齐（done=false 起步）
    expect(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ?").get(occurrence.id)).toEqual({ n: 0 });

    // 模板 children 原样保留（含历史脏 done=1——投影显示已不读它，不再 reset）
    const templateChildren = db
      .prepare("SELECT id, parent_id, done, completed_at FROM tasks WHERE parent_id = ? ORDER BY sort_order")
      .all("rec-with-children");
    expect(templateChildren).toEqual([
      { id: "child-done", parent_id: "rec-with-children", done: 1, completed_at: "2026-06-16T01:00:00.000Z" },
      { id: "child-open", parent_id: "rec-with-children", done: 0, completed_at: null },
    ]);
    expect(db.prepare("SELECT record_id, action FROM sync_seq WHERE table_name = 'tasks' ORDER BY id").all()).toEqual(
      expect.arrayContaining([{ record_id: occurrence.id, action: "create" }]),
    );
  });

  it("done=true child task completes through lightweight update instead of completeTask", async () => {
    seedChild({ id: "child-1", parentId: "task-1", title: "子任务" });

    const res = await app.request("/api/agent/tasks/child-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });

    expect(res.status).toBe(200);
    const row = db.prepare("SELECT done, completed_at FROM tasks WHERE id = ?").get("child-1") as {
      done: number;
      completed_at: string | null;
    };
    expect(row.done).toBe(1);
    expect(row.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(db.prepare("SELECT record_id, action FROM sync_seq WHERE table_name = 'tasks'").all()).toEqual(
      expect.arrayContaining([{ record_id: "child-1", action: "update" }]),
    );
  });

  it("done=false child task reopens and clears completedAt", async () => {
    seedChild({
      id: "child-1",
      parentId: "task-1",
      title: "子任务",
      done: true,
      completedAt: "2026-06-16T01:00:00.000Z",
    });

    const res = await app.request("/api/agent/tasks/child-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: false }),
    });

    expect(res.status).toBe(200);
    expect(db.prepare("SELECT done, completed_at FROM tasks WHERE id = ?").get("child-1")).toMatchObject({
      done: 0,
      completed_at: null,
    });
  });

  it("rejects note on child task without creating a grandchild", async () => {
    seedChild({ id: "child-1", parentId: "task-1", title: "子任务" });

    const res = await app.request("/api/agent/tasks/child-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "不应生成孙任务" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { code: "TASK_CHILD_CANNOT_HAVE_CHILDREN" },
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE parent_id = ?").get("child-1")).toEqual({
      count: 0,
    });
  });

  it("rejects child done=true + note without partial update", async () => {
    seedChild({ id: "child-1", parentId: "task-1", title: "子任务" });

    const res = await app.request("/api/agent/tasks/child-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true, note: "不应部分更新" }),
    });

    expect(res.status).toBe(409);
    expect(db.prepare("SELECT done, completed_at FROM tasks WHERE id = ?").get("child-1")).toMatchObject({
      done: 0,
      completed_at: null,
    });
  });

  it("done=true 重复终结(count:1)：完成最后一发后再勾 → 409 RULE_NOT_DUE", async () => {
    seedRecurring("rec-2", '{"freq":"daily","interval":1,"basis":"due","count":1}');
    const first = await app.request("/api/agent/tasks/rec-2/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });
    expect(first.status).toBe(200);
    // 模板保留 recurrence 不就地转化；耗尽由账本（done occurrence 计数）承载
    const tpl = db.prepare("SELECT done, recurrence FROM tasks WHERE id = ?").get("rec-2") as {
      done: number;
      recurrence: string | null;
    };
    expect(tpl.done).toBe(0);
    expect(tpl.recurrence).not.toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE rule_id = ? AND done = 1").get("rec-2")).toEqual({ n: 1 });

    const second = await app.request("/api/agent/tasks/rec-2/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ ok: false, error: { code: "RULE_NOT_DUE" } });
  });

  it("done=true 未到期重复规则：agent 不提前完成，仍回 409 RULE_NOT_DUE", async () => {
    seedRecurring("rec-future", '{"freq":"daily","interval":1,"basis":"due"}');
    db.prepare("UPDATE tasks SET start_at = ? WHERE id = ?").run("2099-12-31T00:00:00.000Z", "rec-future");

    const res = await app.request("/api/agent/tasks/rec-future/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "RULE_NOT_DUE" } });
    expect(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE rule_id = ?").get("rec-future")).toEqual({ n: 0 });
  });

  it("sets tags", async () => {
    db.prepare("UPDATE tasks SET weight = ? WHERE id = ?").run(6, "task-1");

    const res = await app.request("/api/agent/tasks/task-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["agent", "idea"] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { tags: string[] } };
    expect(body.task.tags).toEqual(["agent", "idea"]);
    expect(db.prepare("SELECT tags, weight FROM tasks WHERE id = ?").get("task-1")).toMatchObject({
      tags: JSON.stringify(["agent", "idea"]),
      weight: 6,
    });
  });

  it("returns 404 for missing tasks", async () => {
    const res = await app.request("/api/agent/tasks/missing/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 for empty bodies and legacy state input", async () => {
    const legacyStateField = "tu" + "rn";
    const empty = await app.request("/api/agent/tasks/task-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const invalidTurn = await app.request("/api/agent/tasks/task-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [legacyStateField]: "me" }),
    });

    expect(empty.status).toBe(400);
    expect(invalidTurn.status).toBe(400);
  });
});
