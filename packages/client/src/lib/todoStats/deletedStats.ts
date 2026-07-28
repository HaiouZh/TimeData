import { getDateString, startOfWeek } from "../time.js";

/** 删除归档快照，字段抄 Task 的最小子集；服务端契约以 brief 为准。 */
export interface ArchiveItemSnapshot {
  createdAt: string;
  completedAt?: string | null;
  [key: string]: unknown;
}

export interface ArchiveItem {
  taskId: string;
  deletedAt: string;
  deleteReason: string;
  snapshot: ArchiveItemSnapshot | null;
}

export interface DeletedStats {
  total: number;
  byWeek: Array<{ weekStart: string; count: number }>;
  byReason: Array<{ reason: string; count: number }>;
  survivalBuckets: Array<{ label: string; count: number }>;
  deletedAfterDone: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type SurvivalLabel = "<7天" | "7-30天" | "30-90天" | ">90天";
const SURVIVAL_LABELS: SurvivalLabel[] = ["<7天", "7-30天", "30-90天", ">90天"];

function bucketForSurvivalDays(days: number): SurvivalLabel {
  if (days < 7) return "<7天";
  if (days < 30) return "7-30天";
  if (days < 90) return "30-90天";
  return ">90天";
}

/**
 * 删除洞察聚合：byWeek/byReason 数全部行；survivalBuckets/deletedAfterDone
 * 只数 snapshot 非空的行（坏行——归档写入时快照缺失——只进 total/byReason）。
 * 存活时长 = deletedAt − snapshot.createdAt，左闭右开：恰好 7/30/90 天整归入更大的桶。
 */
export function deletedStats(items: ArchiveItem[]): DeletedStats {
  const total = items.length;

  const weekCounts = new Map<string, number>();
  for (const item of items) {
    const weekKey = startOfWeek(getDateString(new Date(item.deletedAt)));
    weekCounts.set(weekKey, (weekCounts.get(weekKey) ?? 0) + 1);
  }
  const byWeek = [...weekCounts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([weekStart, count]) => ({ weekStart, count }));

  const reasonCounts = new Map<string, number>();
  for (const item of items) {
    reasonCounts.set(item.deleteReason, (reasonCounts.get(item.deleteReason) ?? 0) + 1);
  }
  const byReason = [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count }));

  const survivalCounts = new Map<SurvivalLabel, number>();
  for (const label of SURVIVAL_LABELS) survivalCounts.set(label, 0);
  let deletedAfterDone = 0;
  for (const item of items) {
    if (!item.snapshot) continue;
    const survivalDays =
      (new Date(item.deletedAt).getTime() - new Date(item.snapshot.createdAt).getTime()) / DAY_MS;
    const label = bucketForSurvivalDays(survivalDays);
    survivalCounts.set(label, (survivalCounts.get(label) ?? 0) + 1);
    if (item.snapshot.completedAt) deletedAfterDone += 1;
  }
  const survivalBuckets = SURVIVAL_LABELS.map((label) => ({ label, count: survivalCounts.get(label) ?? 0 }));

  return { total, byWeek, byReason, survivalBuckets, deletedAfterDone };
}
