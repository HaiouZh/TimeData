import type { Goal, Task } from "@timedata/shared";
import { db } from "../db/index.js";
import { removeGoalMemberInCurrentTransaction, sameGoalMember } from "./goals.js";
import { grabTaskToHand } from "./sessions.js";
import { moveTaskToParentInCurrentTransaction, promoteToRoot } from "./tasks.js";

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

/**
 * 子任务升为根任务并直接站到手头。
 *
 * 落 `"inbox"` 而不是 `"today"`：抓到手头与排今天是两个正交动作，promoteToRoot 会按 pool
 * 写 scheduledAt，给 "today" 等于顺手替用户排了期。手头区的行不进 today/inbox 桶，所以这个
 * 选择在手头区不可见，但它决定散场后这条活落回哪儿——落收件箱是对的。
 *
 * 串行两步而非单事务：中途失败是「升了根落在收件箱」，可见可重试，不是收纳那种幽灵态。
 * grabTaskToHand 的既有硬拒（子任务/重复规则/已跳过）一条不改——进它时任务已经是根任务。
 */
export async function promoteTaskToHand(
  taskId: string,
  sortOrder: number,
  now: Date = new Date(),
): Promise<Task> {
  await promoteToRoot(taskId, "inbox", sortOrder, now);
  return grabTaskToHand(taskId, { now });
}
