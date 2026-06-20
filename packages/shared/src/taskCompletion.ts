import { TaskSchema } from "./entitySchemas.js";
import { currentDueDateString, isRecurrenceFinishedAfter } from "./recurrence.js";
import { normalizeScheduledDate } from "./taskDates.js";
import type { Task } from "./types.js";

export interface CompleteTaskOptions {
  now: Date;
  genId: () => string;
  occurrenceSortOrder: number;
  children?: Task[];
}

export interface CompleteTaskResult {
  next: Task;
  occurrence: Task | null;
  occurrenceChildren?: Task[];
  templateChildren?: Task[];
}

/**
 * 把一个任务"完成一次"的纯计算。
 * 非重复=就地完成；重复非终结=衍生 occurrence + 推进模板；重复终结=就地转化模板。
 */
export function completeTask(task: Task, opts: CompleteTaskOptions): CompleteTaskResult {
  if (task.parentId !== null) throw new Error("completeTask requires a root task");

  const { now, genId, occurrenceSortOrder, children = [] } = opts;
  const nowIso = now.toISOString();

  if (!task.recurrence) {
    const next = TaskSchema.parse({
      ...task,
      done: true,
      completedAt: nowIso,
      updatedAt: nowIso,
    });
    return { next, occurrence: null };
  }

  const recurrence = task.recurrence;
  const dueIso = normalizeScheduledDate(currentDueDateString(recurrence, task.lastDoneAt, task.startAt, now));
  // 完成基准日始终取当前应发生日：提前完成顺延一格，过期完成逐次追平；实际点击时刻仍写入 occurrence/completedAt。
  const effectiveDoneIso = dueIso;
  const completedCount = (task.completedCount ?? 0) + 1;
  const countDone = recurrence.count != null && completedCount >= recurrence.count;
  const untilDone = isRecurrenceFinishedAfter(recurrence, task.startAt, effectiveDoneIso);
  const finished = countDone || untilDone;

  if (finished) {
    const next = TaskSchema.parse({
      ...task,
      recurrence: null,
      done: true,
      completedAt: nowIso,
      completedCount,
      lastDoneAt: effectiveDoneIso,
      updatedAt: nowIso,
    });
    return { next, occurrence: null };
  }

  const occurrence = TaskSchema.parse({
    id: genId(),
    parentId: null,
    title: task.title,
    done: true,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedAt: nowIso,
    tags: task.tags ?? [],
    sortOrder: occurrenceSortOrder,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const occurrenceChildren = children.map((child, index) =>
    TaskSchema.parse({
      id: genId(),
      parentId: occurrence.id,
      title: child.title,
      done: child.done,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      completedAt: child.completedAt ?? null,
      tags: child.tags ?? [],
      sortOrder: index,
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
  );

  const templateChildren = children.map((child) =>
    TaskSchema.parse({ ...child, done: false, completedAt: null, updatedAt: nowIso }),
  );

  const next = TaskSchema.parse({
    ...task,
    done: false,
    completedCount,
    lastDoneAt: effectiveDoneIso,
    updatedAt: nowIso,
  });

  return { next, occurrence, occurrenceChildren, templateChildren };
}
