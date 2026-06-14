import { TaskSchema, type Recurrence, type Task } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";

export interface AddTaskInput {
  title: string;
  recurrence?: Recurrence | null;
  startAt?: string | null;
  now?: Date;
}

export interface UpdateTaskPatch {
  title?: string;
  recurrence?: Recurrence | null;
  startAt?: string | null;
  sortOrder?: number;
  now?: Date;
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("任务标题不能为空");
  return trimmed;
}

async function nextSortOrder(): Promise<number> {
  const last = await db.tasks.orderBy("sortOrder").last();
  return last ? last.sortOrder + 1 : 0;
}

async function putTask(next: Task): Promise<Task> {
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", next.updatedAt);
  });
  return next;
}

export async function addTask(input: AddTaskInput): Promise<Task> {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const recurrence = input.recurrence ?? null;
  const task: Task = TaskSchema.parse({
    id: uuid(),
    title: normalizeTitle(input.title),
    done: false,
    recurrence,
    lastDoneAt: null,
    startAt: recurrence ? (input.startAt ?? createdAt) : null,
    sortOrder: await nextSortOrder(),
    createdAt,
    updatedAt: createdAt,
  });

  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await db.tasks.add(task);
    await recordSyncLog("tasks", task.id, "create", task.updatedAt);
  });
  return task;
}

export async function updateTask(id: string, patch: UpdateTaskPatch): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");

  const now = patch.now ?? new Date();
  const updatedAt = now.toISOString();
  const recurrence = patch.recurrence === undefined ? existing.recurrence : patch.recurrence;
  const next: Task = TaskSchema.parse({
    ...existing,
    title: patch.title === undefined ? existing.title : normalizeTitle(patch.title),
    recurrence,
    done: recurrence ? false : existing.done,
    lastDoneAt: recurrence ? existing.lastDoneAt : null,
    startAt: recurrence ? (patch.startAt ?? existing.startAt ?? updatedAt) : null,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
    updatedAt,
  });

  return putTask(next);
}

/** 重复任务只盖 lastDoneAt；任务池条目才翻转 done。 */
export async function toggleTaskDone(id: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");

  const now = options.now ?? new Date();
  const updatedAt = now.toISOString();
  const next: Task = existing.recurrence
    ? TaskSchema.parse({ ...existing, done: false, lastDoneAt: updatedAt, updatedAt })
    : TaskSchema.parse({ ...existing, done: !existing.done, updatedAt });

  return putTask(next);
}

export async function deleteTask(id: string): Promise<void> {
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await db.tasks.delete(id);
    await recordSyncLog("tasks", id, "delete");
  });
}

export async function listTasks(): Promise<{ pool: Task[]; recurring: Task[] }> {
  const all = await db.tasks.orderBy("sortOrder").toArray();
  return {
    pool: all.filter((task) => task.recurrence === null),
    recurring: all.filter((task) => task.recurrence !== null),
  };
}
