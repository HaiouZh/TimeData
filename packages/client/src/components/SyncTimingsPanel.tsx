import { getSyncTimings, timingTotalsPercentiles, type SyncPhaseName } from "../sync/phaseTimings.js";

const PHASE_LABELS: Record<SyncPhaseName, string> = {
  status: "状态",
  push: "推送",
  pull: "拉取",
};

const PHASE_ORDER: SyncPhaseName[] = ["status", "push", "pull"];

export default function SyncTimingsPanel() {
  const entries = getSyncTimings();
  if (entries.length === 0) return null;

  const latest = entries[0];
  const phaseText = PHASE_ORDER.filter((phase) => latest.phases[phase] != null)
    .map((phase) => `${PHASE_LABELS[phase]} ${latest.phases[phase]}`)
    .join(" · ");

  const percentiles = timingTotalsPercentiles(entries);

  const metaParts = [
    latest.protocol != null ? latest.protocol : null,
    latest.reason != null ? latest.reason : null,
    latest.connection != null ? latest.connection : null,
  ].filter((part): part is string => part != null);

  return (
    <p className="td-text-caption text-ink-2">
      总耗时 {latest.totalMs}ms{phaseText ? `（${phaseText}）` : ""}
      {latest.waitMs != null && <> · 等待 {latest.waitMs}ms</>}
      {percentiles && (
        <>
          {" · "}
          近{entries.length}次 总耗时 p50 {percentiles.p50}ms / p95 {percentiles.p95}ms
        </>
      )}
      {metaParts.length > 0 && (
        <span className="td-text-caption text-ink-3"> · {metaParts.join(" / ")}</span>
      )}
    </p>
  );
}
