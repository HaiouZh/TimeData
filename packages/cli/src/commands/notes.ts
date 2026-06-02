import { z } from "zod";
import { requestJson, type ApiConfig } from "../lib/api-client.js";
import { todayLocal, validateDate } from "../lib/validation.js";

const UtcIsoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const LocalDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

const CliQuickNoteItemSchema = z.object({
  id: z.string().min(1),
  occurredAt: UtcIsoSchema,
  occurredLocal: LocalDateTimeSchema,
  text: z.string(),
});

const CliQuickNotesSuccessSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(["date", "range", "recent"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  quickNotes: z.array(CliQuickNoteItemSchema),
  summary: z.object({
    count: z.number(),
  }),
  serverTime: UtcIsoSchema,
});

const CliQuickNotesErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});

const CliQuickNotesResponseSchema = z.discriminatedUnion("ok", [
  CliQuickNotesSuccessSchema,
  CliQuickNotesErrorSchema,
]);

type CliNotesErrorResult = { ok: false; error: { code: string; message: string } };

function invalidRequest(message: string): CliNotesErrorResult {
  return { ok: false, error: { code: "INVALID_REQUEST", message } };
}

function validateLimit(value: string | undefined): number | CliNotesErrorResult {
  if (value === undefined) return 50;
  if (!/^\d+$/.test(value)) return invalidRequest("--limit must be an integer between 1 and 200");
  const limit = Number.parseInt(value, 10);
  if (limit < 1 || limit > 200) return invalidRequest("--limit must be an integer between 1 and 200");
  return limit;
}

function pathForFlags(flags: Record<string, string | undefined>): string | CliNotesErrorResult {
  const recent = flags.recent === "true" || flags.recent === "1";
  const date = flags.date;
  const from = flags.from;
  const to = flags.to;
  const limit = validateLimit(flags.limit);
  if (typeof limit !== "number") return limit;

  if (recent) {
    if (date || from || to) return invalidRequest("--recent cannot be combined with --date, --from, or --to");
    return `/api/quick-notes?recent=1&limit=${limit}&format=cli`;
  }

  if (from || to) {
    if (!from || !to) return invalidRequest("--from and --to must be provided together");
    const fromError = validateDate(from);
    if (fromError) return { ok: false, error: fromError };
    const toError = validateDate(to);
    if (toError) return { ok: false, error: toError };
    if (to < from) return invalidRequest("--to must be the same as or later than --from");
    if (date) return invalidRequest("--date cannot be combined with --from or --to");
    return `/api/quick-notes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=cli`;
  }

  const effectiveDate = date || todayLocal();
  const dateError = validateDate(effectiveDate);
  if (dateError) return { ok: false, error: dateError };
  return `/api/quick-notes?date=${encodeURIComponent(effectiveDate)}&format=cli`;
}

export async function runNotes(
  config: ApiConfig,
  flags: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  const path = pathForFlags(flags);
  if (typeof path !== "string") return path;

  const raw = await requestJson(config, path, { fetchImpl });
  if (raw && typeof raw === "object" && "ok" in raw && (raw as { ok: unknown }).ok === false && "error" in raw) return raw;

  const parsed = CliQuickNotesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "SCHEMA_MISMATCH",
        message: "Server returned quick notes in an unexpected shape",
        details: { issues: parsed.error.issues.slice(0, 5) },
      },
    };
  }

  return parsed.data;
}
