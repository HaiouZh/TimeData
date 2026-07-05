import type { SyncReasonCategory } from "@timedata/shared";

const CLIENT_BUG = new Set(["missing_payload", "invalid_shape", "id_mismatch"]);
const USER_ACTIONABLE = new Set([
  "archived_category",
  "missing_category",
  "overlap",
  "invalid_time_range",
  "foreign_key_failed",
]);

export function classifyReasonCode(reasonCode: string): SyncReasonCategory {
  if (reasonCode === "applied") return "applied";
  if (reasonCode === "stale_change_rejected" || reasonCode === "orphan_step_rejected") return "stale_rejected";
  if (reasonCode === "server_version_newer_or_same") return "conflict";
  if (CLIENT_BUG.has(reasonCode)) return "client_bug";
  if (USER_ACTIONABLE.has(reasonCode)) return "user_actionable";
  return "unknown";
}
