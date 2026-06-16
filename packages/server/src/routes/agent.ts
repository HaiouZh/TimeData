import { randomUUID } from "node:crypto";
import { TaskSchema, type SyncChange, type Task } from "@timedata/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { rowToTask, type TaskRow } from "../lib/db-rows.js";
import { notifySyncChange } from "../sync/notifier.js";
import { applyChange } from "../sync/resolver.js";
import { getLatestSeq } from "../sync/seq.js";

const agent = new Hono();

const statusSchema = z
  .object({
    turn: z.enum(["me", "running", "parked"]).nullable().optional(),
    done: z.boolean().optional(),
    note: z.string().trim().min(1).max(5000).optional(),
  })
  .strict()
  .refine((body) => body.turn !== undefined || body.done !== undefined || body.note !== undefined, {
    message: "at least one of turn/done/note is required",
  });

agent.post("/tasks/:id/status", async (c) => {
  const id = c.req.param("id");
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = statusSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid status body", details: parsed.error.issues } },
      400,
    );
  }

  const db = getDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  if (!row) {
    return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Task not found" } }, 404);
  }

  const task = rowToTask(row);
  const now = new Date().toISOString();
  const { turn, done, note } = parsed.data;
  const next: Task = TaskSchema.parse({
    ...task,
    ...(turn !== undefined ? { turn, turnAt: turn === null ? null : now } : {}),
    ...(done === true ? { done: true, turn: null, turnAt: null } : done === false ? { done: false } : {}),
    ...(note ? { subtasks: [...task.subtasks, { id: randomUUID(), title: note, done: false }] } : {}),
    updatedAt: now,
  });
  const change: SyncChange = {
    tableName: "tasks",
    action: "update",
    recordId: id,
    timestamp: now,
    data: next,
  };

  db.transaction(() => {
    applyChange(change);
  })();
  notifySyncChange(getLatestSeq());

  const updated = rowToTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow);
  return c.json({ ok: true, task: updated });
});

export default agent;
