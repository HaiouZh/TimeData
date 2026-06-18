import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

function seedTask(id = "task-1"): void {
  db.prepare(`
    INSERT INTO tasks (id, title, done, recurrence, last_done_at, start_at, sort_order, scheduled_at, subtasks, completed_count, turn, turn_at, created_at, updated_at)
    VALUES (?, ?, 0, NULL, NULL, NULL, 0, NULL, '[]', 0, NULL, NULL, ?, ?)
  `).run(id, "想法", "2026-06-16T00:00:00.000Z", "2026-06-16T00:00:00.000Z");
}

function seedRecurring(id = "rec-1", recurrence = '{"freq":"daily","interval":1,"basis":"due"}'): void {
  db.prepare(`
    INSERT INTO tasks (id, title, done, recurrence, last_done_at, start_at, sort_order, scheduled_at, subtasks, completed_count, turn, turn_at, created_at, updated_at)
    VALUES (?, ?, 0, ?, NULL, ?, 0, NULL, '[]', 0, NULL, NULL, ?, ?)
  `).run(
    id,
    "跑步",
    recurrence,
    "2026-06-01T00:00:00.000Z",
    "2026-06-01T00:00:00.000Z",
    "2026-06-01T00:00:00.000Z",
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
  it("sets turn, stamps turnAt, appends note, records seq and notifies listeners", async () => {
    const { addSyncStreamListener, removeSyncStreamListener } = await import("../sync/notifier.js");
    const seen: Array<number | null> = [];
    const listener = (seq: number | null) => seen.push(seq);
    addSyncStreamListener(listener);

    try {
      const res = await app.request("/api/agent/tasks/task-1/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turn: "me", note: "done PR#123" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        task: { turn: string; turnAt: string; subtasks: Array<{ title: string; done: boolean }> };
      };
      expect(body.ok).toBe(true);
      expect(body.task.turn).toBe("me");
      expect(body.task.turnAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(body.task.subtasks.at(-1)).toMatchObject({ title: "done PR#123", done: false });
      expect(db.prepare("SELECT turn, turn_at FROM tasks WHERE id = ?").get("task-1")).toMatchObject({
        turn: "me",
        turn_at: body.task.turnAt,
      });
      expect(db.prepare("SELECT table_name, record_id, action FROM sync_seq ORDER BY id DESC LIMIT 1").get()).toMatchObject({
        table_name: "tasks",
        record_id: "task-1",
        action: "update",
      });
      expect(seen.at(-1)).toBeGreaterThan(0);
    } finally {
      removeSyncStreamListener(listener);
    }
  });

  it("sets done=true and clears turn state", async () => {
    db.prepare("UPDATE tasks SET turn = ?, turn_at = ? WHERE id = ?").run("running", "2026-06-16T01:00:00.000Z", "task-1");

    const res = await app.request("/api/agent/tasks/task-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { done: boolean; turn: string | null; turnAt: string | null } };
    expect(body.task.done).toBe(true);
    expect(body.task.turn).toBeNull();
    expect(body.task.turnAt).toBeNull();
  });

  it("done=true 普通任务：写 completedAt 并清 turn", async () => {
    db.prepare("UPDATE tasks SET turn = ?, turn_at = ? WHERE id = ?").run("running", "2026-06-16T01:00:00.000Z", "task-1");
    const res = await app.request("/api/agent/tasks/task-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });

    expect(res.status).toBe(200);
    const row = db.prepare("SELECT done, completed_at, turn FROM tasks WHERE id = ?").get("task-1") as {
      done: number;
      completed_at: string | null;
      turn: string | null;
    };
    expect(row.done).toBe(1);
    expect(row.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.turn).toBeNull();
  });

  it("done=true 重复非终结：衍生一条已完成行 + 模板推进", async () => {
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
    expect(tpl.done).toBe(0);
    expect(tpl.recurrence).not.toBeNull();
    expect(tpl.completed_count).toBe(1);
    expect(tpl.last_done_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const after = (db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
    expect(after).toBe(before + 1);
    const occ = db.prepare("SELECT done, recurrence, completed_at, title FROM tasks WHERE id != ? AND title = ?").get("rec-1", "跑步") as {
      done: number;
      recurrence: string | null;
      completed_at: string | null;
      title: string;
    };
    expect(occ).toMatchObject({ done: 1, recurrence: null });
    expect(occ.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("done=true 重复终结(count:1)：就地转化、不新增行", async () => {
    seedRecurring("rec-2", '{"freq":"daily","interval":1,"basis":"due","count":1}');
    const before = (db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
    const res = await app.request("/api/agent/tasks/rec-2/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });

    expect(res.status).toBe(200);
    const row = db.prepare("SELECT done, recurrence, completed_at FROM tasks WHERE id = ?").get("rec-2") as {
      done: number;
      recurrence: string | null;
      completed_at: string | null;
    };
    expect(row).toMatchObject({ done: 1, recurrence: null });
    expect(row.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const after = (db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it("sets tags", async () => {
    const res = await app.request("/api/agent/tasks/task-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["agent", "idea"] }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { tags: string[] } };
    expect(body.task.tags).toEqual(["agent", "idea"]);
    expect(db.prepare("SELECT tags FROM tasks WHERE id = ?").get("task-1")).toMatchObject({
      tags: JSON.stringify(["agent", "idea"]),
    });
  });

  it("returns 404 for missing tasks", async () => {
    const res = await app.request("/api/agent/tasks/missing/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turn: "me" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 for empty bodies and invalid turn values", async () => {
    const empty = await app.request("/api/agent/tasks/task-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const invalidTurn = await app.request("/api/agent/tasks/task-1/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turn: "done" }),
    });

    expect(empty.status).toBe(400);
    expect(invalidTurn.status).toBe(400);
  });
});
