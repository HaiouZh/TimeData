import type { Goal, Task } from "@timedata/shared";
import { db } from "../db/index.js";
import { assignTaskToProject, removeGoalMemberInCurrentTransaction, sameGoalMember } from "./goals.js";
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

  await db.transaction("rw", db.tasks, db.goals, db.goalLayoutPins, db.taskRelations, db.syncLog, async () => {
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
 * 串行两步而非单事务：中途失败是「升了根、落回它自身字段决定的分区（通常是收件箱；
 * 若子任务带休眠 recurrence，升根后规则复活，会落重复管理区而非收件箱——降级不清能力字段，
 * 见母文 todo.md §2.2）」，可见可重试，不是收纳那种幽灵态。
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

/**
 * 子任务升为根任务并**回到它爹所在的那个项目组**。
 *
 * 与 `promoteTaskToHand` 同形，两条设计都照抄它的理由：
 * - 落 `"inbox"` 而非 `"today"`：`promoteToRoot` 会按 pool 写 `scheduledAt`，给 `"today"`
 *   等于替用户排了期，而「回到项目」的语义里没有排期这一项。
 * - **串行两步、不合事务**：中途失败是「升了根、落回它自身字段决定的分区」——通常是收件箱，
 *   看得见、能重拖，不是收纳那种投影层查不到的幽灵态。合成一个事务要把 `assignTaskToProject`
 *   的先摘后加拆开重写，收益不抵风险。
 *
 * `assignTaskToProject` 的 `subtask` 准入闸不会被这条路径触发——进它时任务已经是根任务。
 * 但 `recurring` 那支会：降级不清能力字段，子任务可能带休眠 `recurrence`，升根后规则复活。
 * 那种情形下它升根成功、入组被拒，落的是重复管理区而不是收件箱，调用方的失败文案要分开说。
 *
 * 不调 `prerequisiteLossOnAssign`：子任务不持有归属，摘不到任何源组，预测函数恒返回 null。
 *
 * **返回 void 而不是升根后的 Task**：入组会再改一次该行的 `updatedAt`，
 * 第一步的返回值此刻已经过时，交出去只会被误当成最新快照。
 */
export async function promoteTaskToProject(
  taskId: string,
  goalId: string,
  sortOrder: number,
  now: Date = new Date(),
): Promise<void> {
  await promoteToRoot(taskId, "inbox", sortOrder, now);
  await assignTaskToProject(goalId, taskId, { now });
}
