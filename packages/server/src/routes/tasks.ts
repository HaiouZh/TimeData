import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { rowToTask, type TaskRow } from "../lib/db-rows.js";
import { notifySyncChange } from "../sync/notifier.js";
import { getLatestSeq, recordSeqWithDb } from "../sync/seq.js";

const tasks = new Hono();

const querySchema = z
  .object({
    kind: z.enum(["pool", "recurring"]).optional(),
    done: z.enum(["0", "1"]).optional(),
  })
  .strict();

tasks.get("/", (c) => {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid query", details: parsed.error.issues } },
      400,
    );
  }

  const rows = getDb()
    .prepare("SELECT * FROM tasks WHERE parent_id IS NULL ORDER BY sort_order, created_at, id")
    .all() as TaskRow[];
  let result = rows.map(rowToTask);

  if (parsed.data.kind === "pool") {
    result = result.filter((task) => task.recurrence === null);
  } else if (parsed.data.kind === "recurring") {
    result = result.filter((task) => task.recurrence !== null);
  }

  if (parsed.data.done !== undefined) {
    const done = parsed.data.done === "1";
    result = result.filter((task) => task.done === done);
  }

  return c.json({ ok: true, tasks: result });
});

// --- GET /deleted-archive ---
// 必须注册在 /:id 类参数路由之前，防止被吞。

const archiveQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .strict();

interface ArchiveRow {
  task_id: string;
  payload: string;
  delete_reason: string;
  deleted_at: string;
}

interface ArchiveSnapshot {
  title: string;
  createdAt: string | null;
  done: boolean;
  completedAt: string | null;
  tags: string[];
}

function parseArchiveSnapshot(payload: string): ArchiveSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const row = parsed as Record<string, unknown>;
  return {
    title: typeof row.title === "string" ? row.title : "",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : (typeof row.created_at === "string" ? row.created_at : null),
    done: typeof row.done === "boolean" ? row.done : row.done === 1,
    completedAt: typeof row.completedAt === "string" ? row.completedAt : (typeof row.completed_at === "string" ? row.completed_at : null),
    tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

tasks.get("/deleted-archive", (c) => {
  const parsed = archiveQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    return c.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid query", details: parsed.error.issues } },
      400,
    );
  }

  const conditions: string[] = [];
  const params: string[] = [];
  if (parsed.data.from !== undefined) {
    conditions.push("deleted_at >= ?");
    params.push(parsed.data.from);
  }
  if (parsed.data.to !== undefined) {
    conditions.push("deleted_at <= ?");
    params.push(parsed.data.to);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = getDb()
    .prepare(`SELECT * FROM deleted_tasks_archive ${where} ORDER BY deleted_at, id`)
    .all(...params) as ArchiveRow[];

  const items = rows.map((row) => ({
    taskId: row.task_id,
    deletedAt: row.deleted_at,
    deleteReason: row.delete_reason,
    snapshot: parseArchiveSnapshot(row.payload),
  }));

  return c.json({ ok: true, items });
});

// --- POST /:id/schedule ---

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const scheduleSchema = z.object({ scheduledDate: DateSchema.nullable() }).strict();

// v1 用服务器进程本地时区；多时区场景留 TODO
function localDateToUtcIso(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const local = new Date(y, m - 1, d);
  return new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString();
}

tasks.post("/:id/schedule", async (c) => {
  const id = c.req.param("id");
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = scheduleSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: { code: "INVALID_REQUEST", message: "Invalid schedule body", details: parsed.error.issues } },
      400,
    );
  }

  const db = getDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  if (!row) {
    return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Task not found" } }, 404);
  }

  const task = rowToTask(row);
  if (task.recurrence) {
    return c.json(
      { ok: false, error: { code: "TASK_RECURRING_USE_RULE", message: "Recurring task schedule is managed via its repeat rule" } },
      409,
    );
  }
  // occurrence（rule 的单发）：scheduledAt 同时是账本应发生日游标，外部改期会拖歪整条规则的推进。
  // 单独一个 code，好让调用方区分「模板」与「这一发」。
  if (task.ruleId !== null) {
    return c.json(
      { ok: false, error: { code: "TASK_OCCURRENCE_NOT_SCHEDULABLE", message: "Occurrence schedule is derived from its rule and cannot be changed here" } },
      409,
    );
  }

  const now = new Date().toISOString();
  const scheduledAt = parsed.data.scheduledDate === null ? null : localDateToUtcIso(parsed.data.scheduledDate);

  db.transaction(() => {
    db.prepare("UPDATE tasks SET scheduled_at = ?, updated_at = ? WHERE id = ?").run(scheduledAt, now, id);
    recordSeqWithDb(db, "tasks", id, "update");
  })();

  const updated = rowToTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow);
  notifySyncChange(getLatestSeq());
  return c.json({ ok: true, task: updated });
});

export default tasks;
