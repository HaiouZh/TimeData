import type { TrackMilestone } from "./types.js";

/** 里程碑排序唯一口径：(position, createdAt, id) 升序。position 由写入侧重编号维护。 */
export function compareTrackMilestones(a: TrackMilestone, b: TrackMilestone): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function orderMilestones(list: readonly TrackMilestone[]): TrackMilestone[] {
  return [...list].sort(compareTrackMilestones);
}

/** 进度口径：dropped 是独立终态、从分母剔除（「不做」不是「完成」的变体）。 */
export function milestoneProgress(list: readonly TrackMilestone[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const item of list) {
    if (item.status === "dropped") continue;
    total += 1;
    if (item.status === "done") done += 1;
  }
  return { done, total };
}

/** 当前段 = 排序后第一个 pending；无 pending（全完成/全砍掉）返回 null。 */
export function currentMilestone(list: readonly TrackMilestone[]): TrackMilestone | null {
  for (const item of orderMilestones(list)) {
    if (item.status === "pending") return item;
  }
  return null;
}
