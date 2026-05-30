import { type SyncStatus, useSyncContext } from "../contexts/SyncContext.tsx";

const BASE_CLASS = "absolute right-2 top-2 h-2 w-2 rounded-full border border-white/90 shadow-sm pointer-events-none";

export function syncIndicatorClassName(status: SyncStatus): string {
  if (status === "disabled") return `${BASE_CLASS} bg-gray-400`;
  if (status === "syncing") return `${BASE_CLASS} bg-yellow-500 animate-sync-pulse`;
  if (status === "error") return `${BASE_CLASS} bg-red-500 animate-sync-blink`;
  if (status === "pending") return `${BASE_CLASS} bg-blue-500`;
  return `${BASE_CLASS} bg-green-500`;
}

const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  disabled: "未开启",
  syncing: "同步中",
  error: "同步错误",
  pending: "待上传",
  success: "已同步",
  idle: "已同步",
};

export default function SyncIndicator() {
  const { status } = useSyncContext();

  return (
    <span
      aria-label={`同步状态：${SYNC_STATUS_LABEL[status]}`}
      className={syncIndicatorClassName(status)}
      role="status"
    />
  );
}
