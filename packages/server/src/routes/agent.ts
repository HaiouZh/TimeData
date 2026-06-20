import { randomUUID } from "node:crypto";
import { completeTask, TaskSchema, type SyncChange, type Task } from "@timedata/shared";
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
    done: z.boolean().optional(),
    note: z.string().trim().min(1).max(5000).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  })
  .strict()
  .refine((body) => body.done !== undefined || body.note !== undefined || body.tags !== undefined, {
    message: "at least one of done/note/tags is required",
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
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const { done, note, tags } = parsed.data;

  let occurrence: Task | null = null;
  let occurrenceChildren: Task[] = [];
  let templateChildren: Task[] = [];
  let noteChild: Task | null = null;
  let next: Task;
  if (done === true) {
    const sortRow = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks").get() as { next: number };
    const children = (db
      .prepare("SELECT * FROM tasks WHERE parent_id = ? ORDER BY sort_order, id")
      .all(id) as TaskRow[]).map(rowToTask);
    const completed = completeTask(task, {
      now: nowDate,
      genId: () => randomUUID(),
      occurrenceSortOrder: sortRow.next,
      children,
    });
    occurrence = completed.occurrence;
    occurrenceChildren = completed.occurrenceChildren ?? [];
    templateChildren = completed.templateChildren ?? [];
    next = TaskSchema.parse({
      ...completed.next,
      ...(tags !== undefined ? { tags } : {}),
      updatedAt: now,
    });
  } else {
    next = TaskSchema.parse({
      ...task,
      ...(done === false ? { done: false } : {}),
      ...(tags !== undefined ? { tags } : {}),
      updatedAt: now,
    });
  }

  if (note) {
    const childSortRow = db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks WHERE parent_id = ?")
      .get(next.id) as { next: number };
    noteChild = TaskSchema.parse({
      id: randomUUID(),
      parentId: next.id,
      title: note,
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      completedAt: null,
      tags: [],
      sortOrder: childSortRow.next,
      createdAt: now,
      updatedAt: now,
    });
  }

  const taskCreate = (task: Task): SyncChange => ({
    tableName: "tasks",
    action: "create",
    recordId: task.id,
    timestamp: now,
    data: task,
  });
  const taskUpdate = (task: Task): SyncChange => ({
    tableName: "tasks",
    action: "update",
    recordId: task.id,
    timestamp: now,
    data: task,
  });

  db.transaction(() => {
    if (occurrence) {
      applyChange(taskCreate(occurrence));
    }
    for (const child of occurrenceChildren) {
      applyChange(taskCreate(child));
    }
    for (const child of templateChildren) {
      applyChange(taskUpdate(child));
    }
    if (noteChild) {
      applyChange(taskCreate(noteChild));
    }
    applyChange(taskUpdate(next));
  })();
  notifySyncChange(getLatestSeq());

  const updated = rowToTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow);
  return c.json({ ok: true, task: updated });
});

export default agent;
