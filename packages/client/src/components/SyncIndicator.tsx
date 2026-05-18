import { type SyncStatus, useSyncContext } from "../contexts/SyncContext.tsx";

const BASE_CLASS = "absolute right-2 top-2 h-2 w-2 rounded-full border border-white/90 shadow-sm pointer-events-none";

export function syncIndicatorClassName(status: SyncStatus): string {
  if (status === "disabled") return `${BASE_CLASS} bg-gray-400`;
  if (status === "syncing") return `${BASE_CLASS} bg-yellow-500 animate-sync-pulse`;
  if (status === "error") return `${BASE_CLASS} bg-red-500 animate-sync-blink`;
  return `${BASE_CLASS} bg-green-500`;
}

export default function SyncIndicator() {
  const { status } = useSyncContext();

  return <span aria-label={`同步状态：${status}`} className={syncIndicatorClassName(status)} role="status" />;
}
