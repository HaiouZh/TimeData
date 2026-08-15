import { randomUUID } from "node:crypto";
import { completionOp, latestOccurrenceForRule, materializeDue, TaskSchema, UtcIsoStringSchema, type SyncChange, type Task } from "@timedata/shared";
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

const createTaskSchema = z
  .object({
    title: z.string().trim().min(1),
    createdAt: UtcIsoStringSchema,
    scheduledAt: UtcIsoStringSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
    done: z.boolean().optional(),
    completedAt: UtcIsoStringSchema.optional(),
    requestId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

// 时钟漂移容差：允许调用方的时间略快于服务端，但不接受真正的未来时间。
const FUTURE_TOLERANCE_MS = 5 * 60_000;

agent.post("/tasks", async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = createTaskSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid create task body", details: parsed.error.issues } },
      400,
    );
  }

  const db = getDb();
  const id = parsed.data.requestId ?? randomUUID();

  const { done = false, completedAt } = parsed.data;
  const nowMs = Date.now();
  const createdMs = Date.parse(parsed.data.createdAt);

  const invalid = (message: string) =>
    c.json({ ok: false, error: { code: "INVALID_REQUEST", message } }, 400);

  // 回填方向不对称：向历史不设限（日终跑写的就是更早的时刻，也可能补跑前几天），
  // 向未来卡容差（防时钟漂移把未来时间写进账）。
  if (createdMs > nowMs + FUTURE_TOLERANCE_MS) {
    return invalid("createdAt must not be more than 5 minutes in the future");
  }
  if (done && completedAt === undefined) {
    return invalid("completedAt is required when done is true");
  }
  if (!done && completedAt !== undefined) {
    return invalid("completedAt must be omitted when done is false");
  }
  if (completedAt !== undefined) {
    const completedMs = Date.parse(completedAt);
    if (completedMs > nowMs + FUTURE_TOLERANCE_MS) {
      return invalid("completedAt must not be more than 5 minutes in the future");
    }
    if (completedMs < createdMs) {
      return invalid("completedAt must not be earlier than createdAt");
    }
  }

  // requestId 幂等：同一投递重试命中已有记录时返回原记录，不重复落库（对齐 quick-notes / agent-tracks 端点）。
  const existingRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  if (existingRow) {
    return c.json({ ok: true, task: rowToTask(existingRow), idempotent: true });
  }

  const now = new Date().toISOString();
  const sortRow = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks").get() as {
    next: number;
  };
  const task = TaskSchema.parse({
    id,
    parentId: null,
    title: parsed.data.title,
    done: parsed.data.done ?? false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: parsed.data.scheduledAt ?? null,
    completedCount: 0,
    weight: 0,
    completedAt: parsed.data.completedAt ?? null,
    tags: parsed.data.tags ?? [],
    ruleId: null,
    sessionId: null,
    skipped: false,
    sortOrder: sortRow.next,
    createdAt: parsed.data.createdAt,
    updatedAt: now,
  });
  // op.at 用服务端记账时刻 now，不是回填的 completedAt：op 参与 LWW 冲突判定，
  // 用历史时间会让这条 create 在与其他设备比对时被误判为陈旧写入。
  // 业务上「什么时候完成的」由 data.completedAt 承载，两者刻意分离。
  const op = completionOp(undefined, task, now);
  const change: SyncChange = {
    tableName: "tasks",
    action: "create",
    recordId: task.id,
    timestamp: now,
    data: task,
    ...(op ? { op } : {}),
  };

  db.transaction(() => {
    applyChange(change);
  })();
  notifySyncChange(getLatestSeq());

  return c.json({ ok: true, task, idempotent: false }, 201);
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
    // 完成重复模板 = 代理到当前可代理 occurrence：有 active 就完成它，
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
