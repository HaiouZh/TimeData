import type { GalaxyRollup } from "../../lib/goalGalaxyRollup.js";

export function GoalGalaxyHud({ rollup }: { rollup: GalaxyRollup }) {
  const pct = Math.round(rollup.ratio * 100);

  return (
    <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border bg-surface-elevated px-3 py-2 text-sm text-ink shadow-sm">
      <span className="font-medium text-accent">全局 {pct}%</span>
      <span className="text-ink-3">
        {rollup.completed}/{rollup.total}
      </span>
      <span className="text-ink-3">本周 {rollup.weekActiveMembers} 处推进</span>
      <span className="text-ink-3">{rollup.activeGoals} 个 goal 在动</span>
    </div>
  );
}
