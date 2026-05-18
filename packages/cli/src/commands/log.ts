import { type ApiConfig, requestJson } from "../lib/api-client.js";
import { todayLocal, validateDate, validateTimeRange } from "../lib/validation.js";

export async function runLog(
  config: ApiConfig,
  flags: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  const start = flags.start;
  const end = flags.end;
  const category = flags.category;

  if (!start || !end || !category) {
    const missing = [
      ["start", start],
      ["end", end],
      ["category", category],
    ].filter(([, value]) => !value).map(([key]) => key);
    return {
      ok: false,
      error: {
        code: "MISSING_ARGUMENT",
        message: `Missing required arguments: ${missing.map((key) => `--${key}`).join(", ")}`,
      },
    };
  }

  const date = flags.date || todayLocal();
  const dateError = validateDate(date);
  if (dateError) return { ok: false, error: dateError };

  const timeError = validateTimeRange(start, end);
  if (timeError) return { ok: false, error: timeError };

  return requestJson(config, "/api/entries", {
    method: "POST",
    body: {
      date,
      start,
      end,
      category,
      note: flags.note || "",
    },
    fetchImpl,
  });
}
