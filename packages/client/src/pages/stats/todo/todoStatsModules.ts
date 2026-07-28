import AgeDistributionSection from "./modules/AgeDistributionSection.tsx";
import CompletedDistributionSection from "./modules/CompletedDistributionSection.tsx";
import CompletionHeatmapSection from "./modules/CompletionHeatmapSection.tsx";
import CreatedDistributionSection from "./modules/CreatedDistributionSection.tsx";
import CycleMetricsSection from "./modules/CycleMetricsSection.tsx";
import DeletedInsightsSection from "./modules/DeletedInsightsSection.tsx";
import DimensionSection from "./modules/DimensionSection.tsx";
import RhythmSection from "./modules/RhythmSection.tsx";
import TodoOverviewSection from "./modules/TodoOverviewSection.tsx";
import type { TodoStatsModuleDef, TodoStatsModuleId } from "./types.ts";

// 期2：补上 "deleted" 模块，注册表键集合与 types.ts 的联合类型对齐。
export const TODO_STATS_MODULES: Partial<Record<TodoStatsModuleId, TodoStatsModuleDef>> = {
  overview: {
    id: "overview",
    title: "总览",
    eyebrow: "Overview",
    description: "待办总量、完成率与各桶分布总览。",
    defaultVisible: true,
    component: TodoOverviewSection,
  },
  created: {
    id: "created",
    title: "创建分布",
    eyebrow: "Created",
    description: "近 12 周新建待办的数量分布。",
    defaultVisible: true,
    component: CreatedDistributionSection,
  },
  completed: {
    id: "completed",
    title: "完成分布",
    eyebrow: "Completed",
    description: "近 12 周完成待办的数量分布。",
    defaultVisible: true,
    component: CompletedDistributionSection,
  },
  age: {
    id: "age",
    title: "存活时长分布",
    eyebrow: "Age",
    description: "未完成待办从创建到现在的存活时长分布。",
    defaultVisible: true,
    component: AgeDistributionSection,
  },
  heatmap: {
    id: "heatmap",
    title: "完成热力图",
    eyebrow: "Heatmap",
    description: "按日期分布的完成事件热力图。",
    defaultVisible: true,
    component: CompletionHeatmapSection,
  },
  cycle: {
    id: "cycle",
    title: "周期指标",
    eyebrow: "Cycle",
    description: "创建到完成的周期时长等关键指标。",
    defaultVisible: true,
    component: CycleMetricsSection,
  },
  rhythm: {
    id: "rhythm",
    title: "节奏",
    eyebrow: "Rhythm",
    description: "按星期/时段划分的创建与完成节奏。",
    defaultVisible: true,
    component: RhythmSection,
  },
  dimension: {
    id: "dimension",
    title: "维度拆解",
    eyebrow: "Dimension",
    description: "按项目/目标等维度拆解待办分布。",
    defaultVisible: true,
    component: DimensionSection,
  },
  deleted: {
    id: "deleted",
    title: "删除洞察",
    eyebrow: "Deleted",
    description: "删除任务的死因归档：按周/原因分布与存活时长。",
    defaultVisible: true,
    component: DeletedInsightsSection,
  },
};

export const TODO_STATS_MODULE_LIST: TodoStatsModuleDef[] = [
  TODO_STATS_MODULES.overview!,
  TODO_STATS_MODULES.created!,
  TODO_STATS_MODULES.completed!,
  TODO_STATS_MODULES.age!,
  TODO_STATS_MODULES.heatmap!,
  TODO_STATS_MODULES.cycle!,
  TODO_STATS_MODULES.rhythm!,
  TODO_STATS_MODULES.dimension!,
  TODO_STATS_MODULES.deleted!,
];
