import { requestJson, type ApiConfig } from "../lib/api-client.js";
import { todayLocal, validateDate, validateTimeRange } from "../lib/validation.js";

export async function runLog(
  config: ApiConfig,
  flags: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  const missing = ["start", "end", "category"].filter((key) => !flags[key]);
  if (missing.length > 0) {
    return { ok: false, error: { code: "MISSING_ARGUMENT", message: `Missing required arguments: ${missing.map((key) => `--${key}`).join(", ")}` } };
  }

  const date = flags.date || todayLocal();
  const dateError = validateDate(date);
  if (dateError) return { ok: false, error: dateError };

  const timeError = validateTimeRange(flags.start!, flags.end!);
  if (timeError) return { ok: false, error: timeError };

  return requestJson(config, "/api/entries", {
    method: "POST",
    body: {
      date,
      start: flags.start!,
      end: flags.end!,
      category: flags.category!,
      note: flags.note || "",
    },
    fetchImpl,
  });
}
