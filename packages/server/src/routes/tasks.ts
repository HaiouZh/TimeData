import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { rowToTask, type TaskRow } from "../lib/db-rows.js";

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

  const rows = getDb().prepare("SELECT * FROM tasks ORDER BY sort_order, created_at, id").all() as TaskRow[];
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

export default tasks;
