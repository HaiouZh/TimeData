import { requestJson, type ApiConfig } from "../lib/api-client.js";
import { todayLocal, validateDate } from "../lib/validation.js";

export async function runList(
  config: ApiConfig,
  flags: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  const date = flags.date || todayLocal();
  const dateError = validateDate(date);
  if (dateError) return { ok: false, error: dateError };
  return requestJson(config, `/api/entries?date=${encodeURIComponent(date)}&format=cli`, { fetchImpl });
}
