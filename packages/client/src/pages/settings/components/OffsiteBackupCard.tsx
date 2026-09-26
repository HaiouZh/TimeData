import type { AdminOffsiteBackupResponse, OffsiteBackupRun } from "@timedata/shared";
import { StatusBanner } from "../../../components/ui/StatusBanner.js";
import { useOffsiteBackupStatus } from "../../../contexts/OffsiteBackupContext.js";
import { formatAppDateTime, formatRelativeTime } from "../../../lib/time.js";

function RecentRuns({ runs }: { runs: OffsiteBackupRun[] }) {
  if (runs.length === 0) return null;
  return (
    <details className="td-text-caption">
      <summary className="cursor-pointer select-none">最近 {runs.length} 次推送</summary>
      <ul className="mt-1 space-y-0.5">
        {runs.map((run) => (
          <li key={run.at}>
            {formatAppDateTime(run.at)} · {run.ok ? "成功" : `失败：${run.error ?? "未知原因"}`}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** 异地冷备状态：failed / stale 显眼报错，ok 安静一行，none（本地开发 / 未部署）不渲染。 */
export function OffsiteBackupCardView({ status, now }: { status: AdminOffsiteBackupResponse | null; now?: Date }) {
  if (!status || status.verdict === "none") return null;
  const lastAt = status.last?.at;

  if (status.verdict === "ok") {
    return (
      <div data-offsite-backup="ok" className="space-y-1 px-1 text-ink-3">
        <p className="td-text-caption">异地冷备 · 最近推送 {lastAt ? formatRelativeTime(lastAt, now) : "—"}</p>
        <RecentRuns runs={status.recent} />
      </div>
    );
  }

  return (
    <StatusBanner tone="danger" role="alert" className="space-y-1" data-offsite-backup={status.verdict}>
      <p className="td-text-label">
        {status.verdict === "stale" ? "异地冷备停了" : "异地冷备失败"}：{status.reason}
      </p>
      {lastAt && (
        <p className="td-text-caption">
          最近一次推送：{formatAppDateTime(lastAt)}（{formatRelativeTime(lastAt, now)}）
        </p>
      )}
      <RecentRuns runs={status.recent} />
    </StatusBanner>
  );
}

export function OffsiteBackupCard() {
  return <OffsiteBackupCardView status={useOffsiteBackupStatus()} />;
}
