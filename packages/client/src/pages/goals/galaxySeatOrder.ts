import type { Goal } from "@timedata/shared";

/** 星图螺旋席位专用稳定序：createdAt 升序 + id 兜底。
 * 一个 goal 一辈子占同一个槽位，禁止混入 updatedAt（列表序 byGoalOrder 是另一种语义）。 */
export function seatOrderedActiveGoals(goals: Goal[]): Goal[] {
  return goals
    .filter((goal) => goal.status === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
