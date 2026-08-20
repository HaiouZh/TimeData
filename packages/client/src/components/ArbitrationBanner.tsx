import { useMemo } from "react";
import { useOptionalSyncContext } from "../contexts/SyncContext.tsx";
import { formatTime, getDateString } from "../lib/time.ts";
import { clearPendingArbitration } from "../sync/arbitration.ts";
import type { PendingArbitration } from "../db/index.ts";
import { StatusBanner } from "./ui/StatusBanner.tsx";

export interface ArbitrationBannerProps {
  onGoToDate?: (date: string) => void;
}

interface ParsedConflict {
  row: PendingArbitration;
  startTime: string;
  endTime: string;
}

export function selectTimeEntryConflicts(rows: PendingArbitration[]): ParsedConflict[] {
  const result: ParsedConflict[] = [];
  for (const row of rows) {
    if (row.tableName !== "time_entries") continue;
    try {
      const data = JSON.parse(row.payloadJson) as Record<string, unknown>;
      if (!data || typeof data !== "object") continue;
      if ("__serializeFailed" in data) continue;
      const startTime = (data as { startTime?: unknown }).startTime;
      const endTime = (data as { endTime?: unknown }).endTime;
      if (typeof startTime !== "string" || typeof endTime !== "string") continue;
      result.push({ row, startTime, endTime });
    } catch {
      // 解不出来的行（含阶段 1 存的 __serializeFailed 存根）跳过，不影响其余行的展示。
    }
  }
  result.sort((a, b) => new Date(b.row.rejectedAt).getTime() - new Date(a.row.rejectedAt).getTime());
  return result;
}

export default function ArbitrationBanner({ onGoToDate }: ArbitrationBannerProps) {
  const syncContext = useOptionalSyncContext();
  const pendingArbitrations: PendingArbitration[] = syncContext?.pendingArbitrations ?? [];
  const conflicts = useMemo(() => selectTimeEntryConflicts(pendingArbitrations), [pendingArbitrations]);

  if (conflicts.length === 0) return null;

  const latest = conflicts[0];
  const dateStr = getDateString(new Date(latest.startTime));
  const timeRange = `${formatTime(latest.startTime)}–${formatTime(latest.endTime)}`;
  const remaining = conflicts.length - 1;

  return (
    <StatusBanner tone="warn" className="mx-4">
      <div className="space-y-2">
        <p className="td-text-body font-medium">有 {conflicts.length} 条记录没能同步到云端 —— 云端在同一时段已有别的记录。</p>
        <p className="td-text-caption">注意：如果你原样再保存一次，云端那些会被删掉。</p>
        <p className="td-text-caption">
          {dateStr} {timeRange}
          {remaining > 0 ? ` 还有 ${remaining} 条` : ""}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onGoToDate?.(dateStr)}
            className="min-h-9 rounded-ctl bg-accent px-3 py-1.5 td-text-caption font-medium text-page transition-colors hover:bg-accent-strong"
          >
            去 {dateStr} 看
          </button>
          <button
            type="button"
            onClick={() => void clearPendingArbitration(latest.row.recordId)}
            className="min-h-9 rounded-ctl border border-border bg-surface px-3 py-1.5 td-text-caption font-medium text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
          >
            知道了
          </button>
        </div>
      </div>
    </StatusBanner>
  );
}
