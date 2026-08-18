import { getSyncTimings, timingTotalsPercentiles, type SyncPhaseName } from "../sync/phaseTimings.js";
import { readLastColdStart } from "../lib/recovery/probe.js";

const PHASE_LABELS: Record<SyncPhaseName, string> = {
  status: "状态",
  push: "推送",
  pull: "拉取",
  bumpApply: "就地应用",
};

const PHASE_ORDER: SyncPhaseName[] = ["status", "push", "pull", "bumpApply"];

export default function SyncTimingsPanel() {
  const entries = getSyncTimings();
  // 冷启动记录与同步记录相互独立：新装的机器可能一条同步都还没有，但已经冷启动过了。
  const coldStart = readLastColdStart();
  if (entries.length === 0 && coldStart === null) return null;

  const latest = entries[0] ?? null;
  const phaseText = latest
    ? PHASE_ORDER.filter((phase) => latest.phases[phase] != null)
        .map((phase) => `${PHASE_LABELS[phase]} ${latest.phases[phase]}`)
        .join(" · ")
    : "";

  const percentiles = timingTotalsPercentiles(entries);

  const metaParts = latest
    ? [
        latest.transport != null ? latest.transport : null,
        latest.protocol != null ? latest.protocol : null,
        latest.reason != null ? latest.reason : null,
        latest.connection != null ? latest.connection : null,
      ].filter((part): part is string => part != null)
    : [];

  return (
    <p className="td-text-caption text-ink-2">
      {latest && (
        <>
          总耗时 {latest.totalMs}ms{phaseText ? `（${phaseText}）` : ""}
          {latest.waitMs != null && <> · 等待 {latest.waitMs}ms</>}
        </>
      )}
      {percentiles && (
        <>
          {" · "}
          近{entries.length}次 总耗时 p50 {percentiles.p50}ms / p95 {percentiles.p95}ms
        </>
      )}
      {metaParts.length > 0 && (
        <span className="td-text-caption text-ink-3"> · {metaParts.join(" / ")}</span>
      )}
      {coldStart && (
        <span className="td-text-caption text-ink-3">
          {latest ? " · " : ""}冷启动 解析 {coldStart.parseMs}ms
          {coldStart.mountMs !== null && <> / 挂载 {coldStart.mountMs}ms</>} / {coldStart.cause}
        </span>
      )}
    </p>
  );
}
