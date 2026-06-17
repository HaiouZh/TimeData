import { type Recurrence, type Task, TaskSchema, type TaskSubtask } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";
import { localDateOf, normalizeScheduledDate, placementForTask } from "./tasks/placement.js";
import { isRecurrenceFinishedAfter } from "./tasks/recurrence.js";
import type { RecurrenceChoice } from "./tasks/recurrencePresets.js";
import { reorderedTaskSortOrders } from "./tasks/taskSort.js";
import { getDateString } from "./time.js";

export interface AddTaskInput {
  title: string;
  recurrence?: Recurrence | null;
  startAt?: string | null;
  scheduledAt?: string | null;
  toInbox?: boolean;
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
  const scheduledAt = recurrence
    ? null
    : input.scheduledAt !== undefined
      ? input.scheduledAt
      : input.toInbox
        ? null
        : localDateOf(now);
  const task: Task = TaskSchema.parse({
    id: uuid(),
    title: normalizeTitle(input.title),
    done: false,
    recurrence,
    lastDoneAt: null,
    startAt: recurrence ? (input.startAt ?? createdAt) : null,
    scheduledAt,
    subtasks: [],
    completedCount: 0,
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

export async function persistTaskOrder(orderedIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    const found = await db.tasks.bulkGet(orderedIds);
    const tasks = found.filter((task): task is Task => task != null);
    if (tasks.length !== orderedIds.length) return;

    const changes = reorderedTaskSortOrders(
      tasks.map((task) => ({ id: task.id, sortOrder: task.sortOrder })),
      orderedIds,
    );
    if (changes.length === 0) return;

    await db.tasks.bulkUpdate(
      changes.map((change) => ({
        key: change.id,
        changes: { sortOrder: change.sortOrder, updatedAt: now },
      })),
    );
    for (const change of changes) {
      await recordSyncLog("tasks", change.id, "update", now);
    }
  });
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
    scheduledAt: existing.scheduledAt ?? null,
    subtasks: existing.subtasks ?? [],
    completedCount: recurrence ? (existing.completedCount ?? 0) : 0,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
    updatedAt,
  });

  return putTask(next);
}

export async function setTaskTurn(id: string, turn: Task["turn"], options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");

  const updatedAt = (options.now ?? new Date()).toISOString();
  const next = TaskSchema.parse({
    ...existing,
    scheduledAt: existing.scheduledAt ?? null,
    subtasks: existing.subtasks ?? [],
    completedCount: existing.completedCount ?? 0,
    turn,
    turnAt: turn === null ? null : updatedAt,
    updatedAt,
  });
  return putTask(next);
}

export async function setTaskTags(id: string, tags: string[], options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");

  const updatedAt = (options.now ?? new Date()).toISOString();
  const next = TaskSchema.parse({
    ...existing,
    scheduledAt: existing.scheduledAt ?? null,
    subtasks: existing.subtasks ?? [],
    completedCount: existing.completedCount ?? 0,
    completedAt: existing.completedAt ?? null,
    tags,
    updatedAt,
  });
  return putTask(next);
}

export async function applyRecurrenceChoice(
  id: string,
  choice: RecurrenceChoice,
  options: { now?: Date } = {},
): Promise<Task> {
  if (choice.kind === "none") {
    return updateTask(id, { recurrence: null, startAt: null, now: options.now });
  }

  if (choice.kind === "recurrence") {
    return updateTask(id, { recurrence: choice.recurrence, startAt: choice.startAt, now: options.now });
  }

  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");

  const updatedAt = (options.now ?? new Date()).toISOString();
  const next = TaskSchema.parse({
    ...existing,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: normalizeScheduledDate(choice.date),
    subtasks: existing.subtasks ?? [],
    completedCount: 0,
    updatedAt,
  });
  return putTask(next);
}

export async function toggleTaskDone(id: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");

  const now = options.now ?? new Date();
  const updatedAt = now.toISOString();
  const base = {
    ...existing,
    scheduledAt: existing.scheduledAt ?? null,
    subtasks: existing.subtasks ?? [],
    completedCount: existing.completedCount ?? 0,
    completedAt: existing.completedAt ?? null,
    tags: existing.tags ?? [],
  };

  let next: Task;
  if (existing.recurrence) {
    const completedCount = base.completedCount + 1;
    const r = existing.recurrence;
    const countDone = r.count != null && completedCount >= r.count;
    const untilDone = isRecurrenceFinishedAfter(r, existing.startAt, now);
    next = TaskSchema.parse({
      ...base,
      completedCount,
      lastDoneAt: updatedAt,
      done: countDone || untilDone,
      updatedAt,
    });
  } else {
    const done = !existing.done;
    next = TaskSchema.parse({ ...base, done, completedAt: done ? updatedAt : null, updatedAt });
  }

  return putTask(next);
}

export async function scheduleTask(id: string, date: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");
  if (existing.recurrence) throw new Error("重复任务不通过排期接口修改，请改重复规则");
  const updatedAt = (options.now ?? new Date()).toISOString();
  const base = { ...existing, scheduledAt: existing.scheduledAt ?? null, subtasks: existing.subtasks ?? [] };
  const next = TaskSchema.parse({ ...base, scheduledAt: normalizeScheduledDate(date), updatedAt });
  return putTask(next);
}

export async function unscheduleTask(id: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");
  if (existing.recurrence) throw new Error("重复任务不能删除排期");
  const updatedAt = (options.now ?? new Date()).toISOString();
  const base = { ...existing, scheduledAt: existing.scheduledAt ?? null, subtasks: existing.subtasks ?? [] };
  const next = TaskSchema.parse({ ...base, scheduledAt: null, updatedAt });
  return putTask(next);
}

export async function updateSubtasks(id: string, subtasks: TaskSubtask[], options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");
  const updatedAt = (options.now ?? new Date()).toISOString();
  const base = { ...existing, scheduledAt: existing.scheduledAt ?? null, subtasks: existing.subtasks ?? [] };
  const next = TaskSchema.parse({ ...base, subtasks, updatedAt });
  return putTask(next);
}

export async function deleteTask(id: string): Promise<void> {
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await db.tasks.delete(id);
    await recordSyncLog("tasks", id, "delete");
  });
}

export interface TodoBuckets {
  today: Task[]; // 含过期，过期排前
  inbox: Task[];
  upcoming: Task[];
  recurring: Task[]; // 重复任务管理列表（全部重复任务，无论落点）
  todayDone: Task[];
  completed: Task[];
}

function isOverdue(t: Task, now: Date): boolean {
  const p = placementForTask(t, now);
  return p.pool === "today" && p.overdue;
}

export async function listTasks(now: Date = new Date()): Promise<TodoBuckets> {
  const todayStr = getDateString(now);
  const all = (await db.tasks.orderBy("sortOrder").toArray()).map((t) => ({
    ...t,
    scheduledAt: t.scheduledAt ?? null,
    subtasks: t.subtasks ?? [],
    completedCount: t.completedCount ?? 0,
    completedAt: t.completedAt ?? null,
    tags: t.tags ?? [],
  }));
  const buckets: TodoBuckets = { today: [], inbox: [], upcoming: [], recurring: [], todayDone: [], completed: [] };
  for (const t of all) {
    if (t.recurrence) buckets.recurring.push(t);
    const p = placementForTask(t, now);
    if (p.pool === "today") buckets.today.push(t);
    else if (p.pool === "inbox") buckets.inbox.push(t);
    else if (p.pool === "upcoming") buckets.upcoming.push(t);
    else if (!t.recurrence && t.done && t.completedAt && getDateString(new Date(t.completedAt)) === todayStr)
      buckets.todayDone.push(t);
    else buckets.completed.push(t);
  }
  buckets.today.sort((a, b) => Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || a.sortOrder - b.sortOrder);
  buckets.todayDone.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  buckets.completed.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return buckets;
}
