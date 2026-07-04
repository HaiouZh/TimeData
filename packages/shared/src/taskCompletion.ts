import type { Task, TaskCompletionOp } from "./types.js";

function completionSnapshot(task: Task) {
  return {
    done: task.done === true,
    completedAt: task.completedAt ?? null,
    skipped: task.skipped === true,
    lastDoneAt: task.lastDoneAt ?? null,
    completedCount: task.completedCount ?? 0,
  };
}

/** 守卫字段 diff -> op。无变化不附 op，避免标题/排序快照授权改完成字段。 */
export function completionOp(prev: Task | undefined, next: Task, at: string): TaskCompletionOp | undefined {
  const before = prev
    ? completionSnapshot(prev)
    : { done: false, completedAt: null, skipped: false, lastDoneAt: null, completedCount: 0 };
  const after = completionSnapshot(next);

  if (
    before.done === after.done
    && before.completedAt === after.completedAt
    && before.skipped === after.skipped
    && before.lastDoneAt === after.lastDoneAt
    && before.completedCount === after.completedCount
  ) {
    return undefined;
  }

  if (after.done && !before.done) return { type: "complete", at };
  if (!after.done && before.done) return { type: "reopen", at };
  if (after.skipped && !before.skipped) return { type: "skip", at };
  return { type: "amend", at };
}
