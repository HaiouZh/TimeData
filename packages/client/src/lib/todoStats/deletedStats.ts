import { addDays, getDateString, startOfWeek } from "../time.js";

/**
 * 删除归档快照，字段抄 Task 的最小子集；服务端契约以 brief 为准。
 * createdAt 对齐服务端 `ArchiveSnapshot.createdAt: string | null`(旧快照缺字段容错为 null)。
 */
export interface ArchiveItemSnapshot {
  createdAt: string | null;
  completedAt?: string | null;
  ruleId?: string | null;
  recurrence?: unknown;
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
 * 只数 snapshot 非空且 createdAt 非空的行（坏行——归档写入时快照缺失，或旧快照缺 createdAt——只进 total/byReason）。
 * 存活时长 = deletedAt − snapshot.createdAt，左闭右开：恰好 7/30/90 天整归入更大的桶。
 * survivalBuckets 另排除 snapshot.ruleId 非空的 occurrence 行：其 createdAt 是系统物化时刻而非立 flag 时刻，会把存活时长压向"<7天"桶。
 * deletedAfterDone 排除 snapshot.recurrence 非空的模板行：一次性任务补加 recurrence 时 done 会重置为 false 但历史 completedAt 不清空，
 * 陈旧 completedAt 不代表该模板作为重复任务"完成过"。
 * byWeek 对齐 distribution 的补零口径：数据跨度内的空周也补 0。
 */
export function deletedStats(items: ArchiveItem[]): DeletedStats {
  const total = items.length;

  const weekCounts = new Map<string, number>();
  for (const item of items) {
    const weekKey = startOfWeek(getDateString(new Date(item.deletedAt)));
    weekCounts.set(weekKey, (weekCounts.get(weekKey) ?? 0) + 1);
  }
  const sortedWeekKeys = [...weekCounts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const byWeek: Array<{ weekStart: string; count: number }> = [];
  if (sortedWeekKeys.length > 0) {
    let cursor = sortedWeekKeys[0];
    const last = sortedWeekKeys[sortedWeekKeys.length - 1];
    while (cursor <= last) {
      byWeek.push({ weekStart: cursor, count: weekCounts.get(cursor) ?? 0 });
      cursor = addDays(cursor, 7);
    }
  }

  const reasonCounts = new Map<string, number>();
  for (const item of items) {
    reasonCounts.set(item.deleteReason, (reasonCounts.get(item.deleteReason) ?? 0) + 1);
  }
  const byReason = [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count }));

  const survivalCounts = new Map<SurvivalLabel, number>();
  for (const label of SURVIVAL_LABELS) survivalCounts.set(label, 0);
  let deletedAfterDone = 0;
  for (const item of items) {
    if (!item.snapshot?.createdAt) continue;
    if ((item.snapshot.ruleId ?? null) == null) {
      const survivalDays =
        (new Date(item.deletedAt).getTime() - new Date(item.snapshot.createdAt).getTime()) / DAY_MS;
      const label = bucketForSurvivalDays(survivalDays);
      survivalCounts.set(label, (survivalCounts.get(label) ?? 0) + 1);
    }
    if (item.snapshot.completedAt && (item.snapshot.recurrence ?? null) == null) deletedAfterDone += 1;
  }
  const survivalBuckets = SURVIVAL_LABELS.map((label) => ({ label, count: survivalCounts.get(label) ?? 0 }));

  return { total, byWeek, byReason, survivalBuckets, deletedAfterDone };
}
