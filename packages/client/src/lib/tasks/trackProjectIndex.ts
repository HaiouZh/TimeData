import type { Goal } from "@timedata/shared";

/** 轨道→项目归属索引：扫 active 的 kind="project" Goal 的 members 里 kind==="track" 的 ref。同轨道被多项目收编时取先扫到的。 */
export function buildTrackProjectIndex(goals: readonly Goal[]): Map<string, { goalId: string; name: string }> {
  const index = new Map<string, { goalId: string; name: string }>();
  for (const goal of goals) {
    if (goal === null || typeof goal !== "object") continue;
    const g = goal as unknown as Record<string, unknown>;
    if (g.kind !== "project") continue;
    if (g.status !== "active") continue;
    const goalId = g.id;
    const name = g.title;
    if (typeof goalId !== "string" || goalId.trim() === "") continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    const members = g.members;
    if (!Array.isArray(members)) continue;
    for (const member of members) {
      if (member === null || typeof member !== "object") continue;
      const m = member as unknown as Record<string, unknown>;
      if (m.kind !== "track") continue;
      const trackId = m.id;
      if (typeof trackId !== "string" || trackId.trim() === "") continue;
      if (!index.has(trackId)) {
        index.set(trackId, { goalId, name });
      }
    }
  }
  return index;
}
