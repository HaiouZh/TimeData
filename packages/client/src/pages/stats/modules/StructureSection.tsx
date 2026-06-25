import { useMemo } from "react";
import { memoStructure } from "../../../lib/insights/cache.ts";
import { INSIGHT_CONSTANTS } from "../../../lib/insights/constants.ts";
import type { StatsModuleProps } from "./types.ts";
import { SectionPanel } from "./ui.tsx";

export default function StructureSection(props: StatsModuleProps) {
  const structure = useMemo(
    () =>
      memoStructure({
        periodEntries: props.entries,
        baselineEntries: props.baselineEntries,
        categories: props.categories,
        periodFrom: props.effectiveRange.fromDate,
        periodTo: props.effectiveRange.toDate,
        baselineFrom: props.baselineFrom,
        baselineTo: props.today,
        sleepCategoryId: props.sleepCategoryId,
      }),
    [
      props.entries,
      props.baselineEntries,
      props.categories,
      props.effectiveRange.fromDate,
      props.effectiveRange.toDate,
      props.baselineFrom,
      props.today,
      props.sleepCategoryId,
    ],
  );

  return (
    <SectionPanel title="结构诊断" eyebrow="Structure">
      {structure.current.sessionCount === 0 ? (
        <p className="text-sm text-slate-500">本周期无足够会话用于结构诊断。</p>
      ) : (
        <>
          <div className="space-y-1 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
            <div className="text-xs text-slate-400">
              深度 vs 浅记录{structure.excludedSleep ? "" : "（含睡眠，指定睡眠分类后更准）"}
            </div>
            <div>
              深度时间占比 <span className="text-emerald-400">{structure.current.deepRatioPct}%</span>
              <span className="text-slate-500">（基线 {structure.baseline.deepRatioPct}%）</span>
            </div>
            <div className="text-xs text-slate-400">
              深度块 {structure.current.deepBlockCount} 个 · 深度门槛 ≥{" "}
              {Math.round(structure.thresholds.deepThresholdMin)}min · 中位会话 {structure.current.medianSessionMin}
              min（基线 {structure.baseline.medianSessionMin}min）
            </div>
          </div>

          <div className="space-y-1 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
            <div className="text-xs text-slate-400">碎片化（仅供观察，不报警）</div>
            <div className="text-xs text-slate-300">
              每活跃小时切换 {structure.fragment.switchesPerActiveHour} 次（基线{" "}
              {structure.fragment.baselineSwitchesPerActiveHour}） · 短会话占比{" "}
              {structure.fragment.shortSessionRatioPct}%（基线 {structure.fragment.baselineShortSessionRatioPct}%）
            </div>
          </div>

          <div className="space-y-1 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-200">
            <div className="text-xs text-slate-400">投入分散度（香农熵）</div>
            <div className="text-xs text-slate-300">
              {structure.entropy.normalizedPct}%（H={structure.entropy.entropyBits} / {structure.entropy.parentCount}{" "}
              类）·{structure.entropy.normalizedPct >= 70 ? " 投入较分散" : " 投入较集中"}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-400">占比失衡</div>
            {structure.baselineDaysWithData < INSIGHT_CONSTANTS.imbalanceMinDaysWithData ? (
              <p className="text-xs text-slate-500">
                基线数据不足（需 ≥ {INSIGHT_CONSTANTS.imbalanceMinDaysWithData} 天），暂不评估占比失衡。
              </p>
            ) : structure.imbalances.length === 0 ? (
              <p className="text-xs text-slate-500">本周期各父分类占比均在你的常态范围内。</p>
            ) : (
              <ul className="space-y-1">
                {structure.imbalances.map((item) => (
                  <li key={item.parentId} className="text-xs">
                    <span className="text-slate-200">{props.parentNameById.get(item.parentId) ?? item.parentId}</span>{" "}
                    <span className={item.direction === "high" ? "text-amber-400" : "text-sky-400"}>
                      {item.currentSharePct}%，{item.direction === "high" ? "高于" : "低于"}你的常态 （
                      {item.baselineMeanPct}%±{item.baselineStdevPct}%）
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </SectionPanel>
  );
}
