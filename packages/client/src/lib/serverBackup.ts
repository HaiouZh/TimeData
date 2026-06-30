import type { SyncBackupResponse } from "@timedata/shared";
import { apiFetch } from "./api.ts";

export function requestServerBackup(): Promise<SyncBackupResponse> {
  return apiFetch<SyncBackupResponse>("/api/sync/backup", { method: "POST" });
}
