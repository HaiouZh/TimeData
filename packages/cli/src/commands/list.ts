import { z } from "zod";
import { requestJson, type ApiConfig } from "../lib/api-client.js";
import { todayLocal, validateDate } from "../lib/validation.js";

const LocalDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

const CliEntryItemSchema = z.object({
  id: z.string().min(1),
  startTime: LocalDateTimeSchema,
  endTime: LocalDateTimeSchema,
  durationMinutes: z.number(),
  category: z.string(),
  note: z.string().nullable(),
});

const CliEntriesListSuccessSchema = z.object({
  ok: z.literal(true),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(CliEntryItemSchema),
  summary: z.object({
    totalMinutes: z.number(),
    entryCount: z.number(),
  }),
});

const CliEntriesListErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string() }),
});

const CliEntriesListResponseSchema = z.discriminatedUnion("ok", [
  CliEntriesListSuccessSchema,
  CliEntriesListErrorSchema,
]);

export async function runList(
  config: ApiConfig,
  flags: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  const date = flags.date || todayLocal();
  const dateError = validateDate(date);
  if (dateError) return { ok: false, error: dateError };

  const raw = await requestJson(config, `/api/entries?date=${encodeURIComponent(date)}&format=cli`, { fetchImpl });
  if (raw && typeof raw === "object" && "ok" in raw && (raw as { ok: unknown }).ok === false && "error" in raw) return raw;

  const parsed = CliEntriesListResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "SCHEMA_MISMATCH",
        message: "Server returned entries in an unexpected shape",
        details: { issues: parsed.error.issues.slice(0, 5) },
      },
    };
  }

  return parsed.data;
}
