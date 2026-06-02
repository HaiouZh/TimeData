import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { listQuickNotesForCli, type QuickNotesQuery } from "../lib/quick-note-service.js";

const quickNotes = new Hono();

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const querySchema = z
  .object({
    date: DateSchema.optional(),
    from: DateSchema.optional(),
    to: DateSchema.optional(),
    recent: z.enum(["1", "true"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    format: z.string().optional(),
  })
  .strict();

function invalidQuery(message: string) {
  return { ok: false, error: { code: "INVALID_REQUEST", message } };
}

quickNotes.get("/", (c) => {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Invalid query", details: parsed.error.issues } }, 400);
  }

  const { date, from, to, recent, limit } = parsed.data;
  let query: QuickNotesQuery;
  if (recent) {
    if (date || from || to) return c.json(invalidQuery("--recent cannot be combined with --date, --from, or --to"), 400);
    query = { mode: "recent", limit };
  } else if (from || to) {
    if (!from || !to) return c.json(invalidQuery("--from and --to must be provided together"), 400);
    if (date) return c.json(invalidQuery("--date cannot be combined with --from or --to"), 400);
    query = { mode: "range", from, to };
  } else if (date) {
    query = { mode: "date", date };
  } else {
    return c.json(invalidQuery("date, from/to, or recent is required"), 400);
  }

  const result = listQuickNotesForCli(getDb(), query);
  return c.json(result, result.ok ? 200 : 400);
});

export default quickNotes;
