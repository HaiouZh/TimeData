import { getSyncTimings, timingTotalsPercentiles, type SyncPhaseName } from "../sync/phaseTimings.js";

const PHASE_LABELS: Record<SyncPhaseName, string> = {
  health: "探活",
  status: "状态",
  backup: "备份",
  push: "推送",
  pull: "拉取",
  report: "上报",
};

const PHASE_ORDER: SyncPhaseName[] = ["health", "status", "backup", "push", "pull", "report"];

export default function SyncTimingsPanel() {
  const entries = getSyncTimings();
  if (entries.length === 0) return null;

  const latest = entries[0];
  const phaseText = PHASE_ORDER.filter((phase) => latest.phases[phase] != null)
    .map((phase) => `${PHASE_LABELS[phase]} ${latest.phases[phase]}`)
    .join(" · ");

  const percentiles = timingTotalsPercentiles(entries);

  return (
    <p className="td-text-caption text-ink-2">
      总耗时 {latest.totalMs}ms{phaseText ? `（${phaseText}）` : ""}
      {percentiles && (
        <>
          {" · "}
          近{entries.length}次 总耗时 p50 {percentiles.p50}ms / p95 {percentiles.p95}ms
        </>
      )}
    </p>
  );
}
