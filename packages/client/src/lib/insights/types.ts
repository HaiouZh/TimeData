// 一段「会话」：同一父分类、相邻条目合并后的连续区间。
export interface InsightSession {
  parentId: string;
  startTime: string; // UTC ISO
  endTime: string; // UTC ISO
  entryIds: string[];
  durationMin: number;
}

// 按本地日期切分后的某条活动片段（跨午夜条目会被拆成多片）。
export interface DaySegment {
  start: string; // UTC ISO，已裁剪到本地日边界内
  end: string; // UTC ISO
  categoryId: string;
  parentId: string;
}

// 单个本地日的预聚合。
export interface DailyRollup {
  date: string; // 本地 YYYY-MM-DD
  totalMin: number; // 该日记录总分钟（已按午夜切分，<= 1440）
  byParent: Record<string, number>; // parentId -> 分钟
  segments: DaySegment[]; // 按 start 升序
  firstActivity: string | null; // 该日首条活动 start（UTC ISO）
  lastActivity: string | null; // 该日末条活动 end（UTC ISO）
}

export type AnomalyType = "overlong" | "overnight" | "sleepTimeActivity" | "longGap" | "unrecordedDay";

// 一条异常洞察卡片。startTime/endTime/categoryId 指向可跳转的源。
export interface Anomaly {
  type: AnomalyType;
  date: string; // 本地 YYYY-MM-DD（卡片归属日）
  startTime?: string; // UTC ISO
  endTime?: string; // UTC ISO
  categoryId?: string;
  valueMin?: number; // 本条的度量值（如时长/空档分钟）
  baselineMin?: number; // 对比基线（如 P95/典型空档）
  message: string; // 可解释中文文案
}
