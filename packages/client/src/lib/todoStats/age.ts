import type { Task } from "@timedata/shared";
import { creationEvents } from "./events.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const OLDEST_LIMIT = 5;

type AgeBucketLabel = "<7天" | "7-30天" | "30-90天" | ">90天";

const BUCKET_LABELS: AgeBucketLabel[] = ["<7天", "7-30天", "30-90天", ">90天"];

export interface AgeBucket {
  label: AgeBucketLabel;
  count: number;
  oldest: Array<{ id: string; title: string; createdAt: string }>;
}

function bucketForAgeDays(ageDays: number): AgeBucketLabel {
  if (ageDays < 7) return "<7天";
  if (ageDays < 30) return "7-30天";
  if (ageDays < 90) return "30-90天";
  return ">90天";
}

/**
 * 年龄分布（存活时长）：只算未完成的创建事件行（creationEvents 过滤 !done）。
 * 重复模板行（recurrence≠null）排除：模板永不 done，单列会失真。
 * 左闭右开：恰好 7/30/90 天整归入更大的桶。
 * oldest：全局最老 5 条（按创建时间升序），每个桶携带同一份全局列表，供展开列表使用。
 */
export function ageBuckets(tasks: Task[], now: Date): AgeBucket[] {
  const candidates = creationEvents(tasks).filter((task) => !task.done && task.recurrence === null);

  const counts = new Map<AgeBucketLabel, number>();
  for (const label of BUCKET_LABELS) counts.set(label, 0);

  for (const task of candidates) {
    const ageDays = (now.getTime() - new Date(task.createdAt).getTime()) / DAY_MS;
    const label = bucketForAgeDays(ageDays);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const oldest = [...candidates]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, OLDEST_LIMIT)
    .map((task) => ({ id: task.id, title: task.title, createdAt: task.createdAt }));

  return BUCKET_LABELS.map((label) => ({
    label,
    count: counts.get(label) ?? 0,
    oldest,
  }));
}
