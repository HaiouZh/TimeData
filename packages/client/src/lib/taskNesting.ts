import type { Goal, Task } from "@timedata/shared";
import { db } from "../db/index.js";
import { removeGoalMemberInCurrentTransaction, sameGoalMember } from "./goals.js";
import { moveTaskToParentInCurrentTransaction } from "./tasks.js";

/**
 * 用户视角的「收纳」：把一条根任务变成 `newParentId` 的子任务，并清空它自己的全部归属指针。
 *
 * 落点是本文件而不是 tasks.ts / goals.ts：`goals.ts` 已单向 import `tasks.ts`，
 * 反向引用会成环；复合动作只能放在两者上层。
 *
 * 降级与清归属必须同一事务：中途失败会留下「既是子任务、又占着项目名单」的幽灵态——
 * 投影层按 parentId 早退看不见它，名单里它还在，用户无从发现也无从修。
 */
export async function nestTaskUnderParent(
  taskId: string,
  newParentId: string,
  now: Date = new Date(),
): Promise<Task> {
  const timestamp = now.toISOString();
  const ref = { kind: "task" as const, id: taskId };
  let moved: Task | null = null;

  await db.transaction("rw", db.tasks, db.goals, db.goalLayoutPins, db.syncLog, async () => {
    moved = await moveTaskToParentInCurrentTransaction(taskId, newParentId, now);
    // 一条任务可能被多个 goal 收，全部清——子任务不占任何项目名单。
    for (const goal of await db.goals.toArray()) {
      if ((goal.members ?? []).some((member) => sameGoalMember(member, ref))) {
        await removeGoalMemberInCurrentTransaction(goal as Goal, ref, timestamp, now);
      }
    }
  });

  if (!moved) throw new Error("任务不存在");
  return moved;
}
