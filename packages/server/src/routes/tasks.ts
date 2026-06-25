import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { rowToTask, type TaskRow } from "../lib/db-rows.js";
import { recordSeq } from "../sync/seq.js";

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

  const now = new Date().toISOString();
  const scheduledAt = parsed.data.scheduledDate === null ? null : localDateToUtcIso(parsed.data.scheduledDate);

  db.prepare("UPDATE tasks SET scheduled_at = ?, updated_at = ? WHERE id = ?").run(scheduledAt, now, id);
  recordSeq("tasks", id, "update");

  const updated = rowToTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow);
  return c.json({ ok: true, task: updated });
});

export default tasks;
