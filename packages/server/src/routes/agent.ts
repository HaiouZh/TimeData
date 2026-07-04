import { randomUUID } from "node:crypto";
import { completionOp, latestOccurrenceForRule, materializeDue, TaskSchema, type SyncChange, type Task } from "@timedata/shared";
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
  const isChild = task.parentId !== null;

  if (note !== undefined && isChild) {
    return c.json(
      {
        ok: false,
        error: {
          code: "TASK_CHILD_CANNOT_HAVE_CHILDREN",
          message: "Child tasks cannot create child notes",
        },
      },
      409,
    );
  }

  let occurrence: Task | null = null;
  let occurrencePrev: Task | undefined;
  let occurrenceIsNew = false;
  let noteChild: Task | null = null;
  let next: Task;
  if (done === true && !isChild && task.recurrence !== null) {
    // 完成重复模板 = 代理到「最新那一发」（scheduledAt 最大且非 skipped）：有 active 就完成它，
    // 无 active 先按引擎物化再完成；引擎判无可发（未到期/耗尽）→ 409。模板本体不承载完成态（§9.2）。
    const occurrences = (db.prepare("SELECT * FROM tasks WHERE rule_id = ?").all(id) as TaskRow[]).map(rowToTask);
    const latest = latestOccurrenceForRule(id, occurrences);
    if (latest !== null && !latest.done) {
      occurrencePrev = latest;
      occurrence = TaskSchema.parse({ ...latest, done: true, completedAt: now, updatedAt: now });
    } else {
      const sortRow = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks").get() as {
        next: number;
      };
      const due = materializeDue(task, occurrences, nowDate, sortRow.next);
      if (due === null) {
        return c.json(
          {
            ok: false,
            error: { code: "RULE_NOT_DUE", message: "Rule has nothing to complete: not due yet or exhausted" },
          },
          409,
        );
      }
      occurrence = TaskSchema.parse({ ...due, done: true, completedAt: now, updatedAt: now });
      occurrenceIsNew = true;
    }
    next = TaskSchema.parse({
      ...task,
      ...(tags !== undefined ? { tags } : {}),
      updatedAt: now,
    });
  } else if (done === true && !isChild) {
    next = TaskSchema.parse({
      ...task,
      done: true,
      completedAt: now,
      ...(tags !== undefined ? { tags } : {}),
      updatedAt: now,
    });
  } else {
    const childDoneFields =
      isChild && done !== undefined
        ? { done, completedAt: done ? now : null }
        : done === false
          ? { done: false }
          : {};
    next = TaskSchema.parse({
      ...task,
      ...childDoneFields,
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

  const taskCreate = (task: Task): SyncChange => {
    const op = completionOp(undefined, task, now);
    return {
      tableName: "tasks",
      action: "create",
      recordId: task.id,
      timestamp: now,
      data: task,
      ...(op ? { op } : {}),
    };
  };
  const taskUpdate = (prev: Task | undefined, task: Task): SyncChange => {
    const op = completionOp(prev, task, now);
    return {
      tableName: "tasks",
      action: "update",
      recordId: task.id,
      timestamp: now,
      data: task,
      ...(op ? { op } : {}),
    };
  };

  db.transaction(() => {
    if (occurrence) {
      applyChange(occurrenceIsNew ? taskCreate(occurrence) : taskUpdate(occurrencePrev, occurrence));
    }
    if (noteChild) {
      applyChange(taskCreate(noteChild));
    }
    applyChange(taskUpdate(task, next));
  })();
  notifySyncChange(getLatestSeq());

  const updated = rowToTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow);
  return c.json({ ok: true, task: updated });
});

export default agent;
