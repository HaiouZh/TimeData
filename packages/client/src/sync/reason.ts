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
  // "validated" 只出现在原子 409 批中，代表"仅校验通过、未落库"——绝不归类为 applied，防止误确认。
  if (reasonCode === "validated") return "unknown";
  if (
    reasonCode === "stale_change_rejected" ||
    reasonCode === "orphan_step_rejected" ||
    reasonCode === "orphan_milestone_rejected"
  )
    return "stale_rejected";
  if (reasonCode === "unseen_record_deletion_rejected") return "needs_arbitration";
  if (reasonCode === "server_version_newer_or_same") return "conflict";
  // 写入生效了，只是服务器守卫住了自己的完成语义列。不是故障、不进 issues，
  // 但推送方必须据此放弃跳过回声 pull，否则服务器保住的那份值永远回不到本地。
  if (reasonCode === "guarded_columns_preserved") return "server_adjusted";
  if (CLIENT_BUG.has(reasonCode)) return "client_bug";
  if (USER_ACTIONABLE.has(reasonCode)) return "user_actionable";
  return "unknown";
}
