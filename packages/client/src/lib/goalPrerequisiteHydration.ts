import type { Goal, GoalPrerequisite, TaskRelation } from "@timedata/shared";
import { db } from "../db/index.js";

function memberKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export function relationsToPrerequisites(relations: TaskRelation[]): GoalPrerequisite[] {
  return relations.map((relation) => ({
    blocker: { kind: relation.blockerKind, id: relation.blockerId },
    blocked: { kind: relation.blockedKind, id: relation.blockedId },
  }));
}

/**
 * 把 taskRelations 里与各目标成员相关的边填回 `goal.prerequisites`，使 `splitGoalMembers`
 * 及其全部下游零改动。
 *
 * **收边口径是「blocked 端在本目标成员内」**，不要求两端都在：一头在外的跨目标边照样填进来，
 * 由 `splitGoalMembers` 既有的 `ignoredPrerequisites` 分支（goalsView.ts:139-140）挡在星图之外。
 * 这条口径让星图行为天然不变，不需要新写筛选逻辑。
 */
export async function hydrateGoalPrerequisites(goals: Goal[]): Promise<Goal[]> {
  if (goals.length === 0) return [];
  const relations = await db.taskRelations.toArray();
  if (relations.length === 0) return goals.map((goal) => ({ ...goal, prerequisites: [] }));

  return goals.map((goal) => {
    const keys = new Set((goal.members ?? []).map((member) => memberKey(member.kind, member.id)));
    const own = relations.filter((relation) => keys.has(memberKey(relation.blockedKind, relation.blockedId)));
    return { ...goal, prerequisites: relationsToPrerequisites(own) };
  });
}
