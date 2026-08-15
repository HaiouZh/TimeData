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
 * **收边口径是「blocker 端与 blocked 端都在本目标成员内」**：星图是「项目内部的依赖视图」，
 * 两端都在项目内才是它的语义。一头在外的跨目标边不进任何目标——`ignoredPrerequisites`
 * 只挡 `splitGoalMembers` 产出的 sections，挡不住图渲染那条路（goalGraphModel.ts 直接全量遍历
 * `prerequisites`，只按 hiddenKeys 过滤），收进来会被 `ensureGraphNode` 画成 ghost 断裂边。
 */
export async function hydrateGoalPrerequisites(goals: Goal[]): Promise<Goal[]> {
  if (goals.length === 0) return [];
  const relations = await db.taskRelations.toArray();
  if (relations.length === 0) return goals.map((goal) => ({ ...goal, prerequisites: [] }));

  return goals.map((goal) => {
    const keys = new Set((goal.members ?? []).map((member) => memberKey(member.kind, member.id)));
    const own = relations.filter(
      (relation) =>
        keys.has(memberKey(relation.blockerKind, relation.blockerId)) &&
        keys.has(memberKey(relation.blockedKind, relation.blockedId)),
    );
    return { ...goal, prerequisites: relationsToPrerequisites(own) };
  });
}
