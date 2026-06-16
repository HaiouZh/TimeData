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
