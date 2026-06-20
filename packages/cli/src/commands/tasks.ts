import { requestJson, type ApiConfig } from "../lib/api-client.js";
import { validateDate } from "../lib/validation.js";

type Err = { ok: false; error: { code: string; message: string } };
const invalid = (message: string): Err => ({ ok: false, error: { code: "INVALID_REQUEST", message } });

export async function runTasks(config: ApiConfig, flags: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<unknown> {
  const kind = flags.kind;
  const done = flags.done;
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (done) params.set("done", done);
  const qs = params.toString();
  return requestJson(config, `/api/tasks${qs ? `?${qs}` : ""}`, { fetchImpl });
}

export async function runTaskSchedule(config: ApiConfig, flags: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<unknown> {
  if (!flags.id) return invalid("--id is required");
  if (!flags.date) return invalid("--date is required (YYYY-MM-DD)");
  const dateErr = validateDate(flags.date);
  if (dateErr) return { ok: false, error: dateErr };
  return requestJson(config, `/api/tasks/${encodeURIComponent(flags.id)}/schedule`, {
    method: "POST", body: { scheduledDate: flags.date }, fetchImpl,
  });
}

export async function runTaskUnschedule(config: ApiConfig, flags: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<unknown> {
  if (!flags.id) return invalid("--id is required");
  return requestJson(config, `/api/tasks/${encodeURIComponent(flags.id)}/schedule`, {
    method: "POST", body: { scheduledDate: null }, fetchImpl,
  });
}

export async function runTaskDone(
  config: ApiConfig,
  flags: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  if (!flags.id) return invalid("--id is required");
  return requestJson(config, `/api/agent/tasks/${encodeURIComponent(flags.id)}/status`, {
    method: "POST",
    body: { done: true },
    fetchImpl,
  });
}

export async function runTaskTag(
  config: ApiConfig,
  flags: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  if (!flags.id) return invalid("--id is required");
  if (!flags.tags) return invalid("--tags is required (comma-separated)");
  const tags = flags.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  if (tags.length === 0) return invalid("--tags must include at least one tag");
  return requestJson(config, `/api/agent/tasks/${encodeURIComponent(flags.id)}/status`, {
    method: "POST",
    body: { tags },
    fetchImpl,
  });
}
