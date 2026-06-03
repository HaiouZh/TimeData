import AnomaliesSection from "./AnomaliesSection.tsx";
import OverviewSection from "./OverviewSection.tsx";
import RoutineSection from "./RoutineSection.tsx";
import StructureSection from "./StructureSection.tsx";
import TrendSection from "./TrendSection.tsx";
import type { StatsModuleDef, StatsModuleId } from "./types.ts";

export const STATS_MODULES: Record<StatsModuleId, StatsModuleDef> = {
  overview: {
    id: "overview",
    title: "总览",
    eyebrow: "Period",
    description: "本周期总时长、记录覆盖率、父子分类构成与环形图。",
    defaultVisible: true,
    component: OverviewSection,
  },
  routine: {
    id: "routine",
    title: "作息",
    eyebrow: "Routine",
    description: "平均入睡/起床/睡眠时长与作息规律度。",
    defaultVisible: true,
    needs: { sleepCategory: true },
    component: RoutineSection,
  },
  anomalies: {
    id: "anomalies",
    title: "异常与空挡",
    eyebrow: "Attention",
    description: "长空挡、未记录日、记录异常等需要注意的点。",
    defaultVisible: true,
    needs: { baseline: true },
    component: AnomaliesSection,
  },
  trend: {
    id: "trend",
    title: "趋势变化",
    eyebrow: "Trend",
    description: "各父分类投入随时间的变化与环比，可选窗口与图表。",
    defaultVisible: true,
    needs: { baseline: true },
    component: TrendSection,
  },
  structure: {
    id: "structure",
    title: "结构诊断",
    eyebrow: "Structure",
    description: "深度时间、碎片化、投入分散度与占比失衡。",
    defaultVisible: true,
    needs: { baseline: true },
    component: StructureSection,
  },
};

export const STATS_MODULE_LIST: StatsModuleDef[] = [
  STATS_MODULES.overview,
  STATS_MODULES.routine,
  STATS_MODULES.anomalies,
  STATS_MODULES.trend,
  STATS_MODULES.structure,
];
