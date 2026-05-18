import { z } from "zod";
import { requestJson, type ApiConfig } from "../lib/api-client.js";
import { todayLocal, validateDate } from "../lib/validation.js";

const CliEntryItemSchema = z.object({
  id: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  durationMinutes: z.number(),
  category: z.string(),
  note: z.string().nullable(),
});

const CliEntriesListResponseSchema = z.object({
  ok: z.boolean(),
  date: z.string().optional(),
  entries: z.array(CliEntryItemSchema).optional(),
  summary: z.object({
    totalMinutes: z.number(),
    entryCount: z.number(),
  }).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

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
