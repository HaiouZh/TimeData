import { completeTask, type Recurrence, type Task, TaskSchema } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";
import { localDateOf, normalizeScheduledDate, placementForTask } from "./tasks/placement.js";
import { currentDueDateString } from "./tasks/recurrence.js";
import type { RecurrenceChoice } from "./tasks/recurrencePresets.js";
import { reorderedTaskSortOrders } from "./tasks/taskSort.js";

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

async function nextChildSortOrder(parentId: string): Promise<number> {
  const children = await db.tasks.where("parentId").equals(parentId).toArray();
  return children.length === 0 ? 0 : Math.max(...children.map((child) => child.sortOrder)) + 1;
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
    parentId: null,
    title: normalizeTitle(input.title),
    done: false,
    recurrence,
    lastDoneAt: null,
    startAt: recurrence ? (input.startAt ?? createdAt) : null,
    scheduledAt,    completedCount: 0,
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

/**
 * 在同一父任务下重排子任务：读出当前 children（按 sortOrder），把 activeId 移到 overId 处，
 * 再走 persistTaskOrder 回填槽位。只传子任务自己的 id，故仅在它们自身的 sortOrder 槽位内重排，
 * 不影响根任务排序；顺序未变时 persistTaskOrder 自身短路不写库。
 */
export async function reorderChildren(parentId: string, activeId: string, overId: string): Promise<void> {
  const children = await db.tasks.where("parentId").equals(parentId).sortBy("sortOrder");
  const ids = children.map((child) => child.id);
  const oldIndex = ids.indexOf(activeId);
  const newIndex = ids.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
  const ordered = ids.slice();
  const [moved] = ordered.splice(oldIndex, 1);
  ordered.splice(newIndex, 0, moved);
  await persistTaskOrder(ordered);
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
    scheduledAt: existing.scheduledAt ?? null,    completedCount: recurrence ? (existing.completedCount ?? 0) : 0,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
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
    scheduledAt: existing.scheduledAt ?? null,    completedCount: existing.completedCount ?? 0,
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
    scheduledAt: normalizeScheduledDate(choice.date),    completedCount: 0,
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
    parentId: existing.parentId ?? null,
    scheduledAt: existing.scheduledAt ?? null,    completedCount: existing.completedCount ?? 0,
    completedAt: existing.completedAt ?? null,
    tags: existing.tags ?? [],
  };

  if ((base.parentId ?? null) !== null) {
    const completedAt = base.done ? null : updatedAt;
    const next = TaskSchema.parse({ ...base, done: !base.done, completedAt, updatedAt });
    return putTask(next);
  }

  // 非重复且当前已完成 → 翻回未完成；重复任务的勾选只表示“完成一次”，不走撤销。
  if (!base.recurrence && base.done) {
    const reopened = TaskSchema.parse({ ...base, done: false, completedAt: null, updatedAt });
    return putTask(reopened);
  }

  const children = base.recurrence ? await db.tasks.where("parentId").equals(id).sortBy("sortOrder") : [];
  const { next, occurrence, occurrenceChildren = [], templateChildren = [] } = completeTask(base as Task, {
    now,
    genId: uuid,
    occurrenceSortOrder: await nextSortOrder(),
    children,
  });

  if (!occurrence) return putTask(next);

  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await db.tasks.add(occurrence);
    await recordSyncLog("tasks", occurrence.id, "create", occurrence.updatedAt);
    for (const child of occurrenceChildren) {
      await db.tasks.add(child);
      await recordSyncLog("tasks", child.id, "create", child.updatedAt);
    }
    for (const child of templateChildren) {
      await db.tasks.put(child);
      await recordSyncLog("tasks", child.id, "update", child.updatedAt);
    }
    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", next.updatedAt);
  });
  return next;
}

export async function scheduleTask(id: string, date: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");
  if (existing.recurrence) throw new Error("重复任务不通过排期接口修改，请改重复规则");
  const updatedAt = (options.now ?? new Date()).toISOString();
  const base = { ...existing, scheduledAt: existing.scheduledAt ?? null };
  const next = TaskSchema.parse({ ...base, scheduledAt: normalizeScheduledDate(date), updatedAt });
  return putTask(next);
}

export async function unscheduleTask(id: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");
  if (existing.recurrence) throw new Error("重复任务不能删除排期");
  const updatedAt = (options.now ?? new Date()).toISOString();
  const base = { ...existing, scheduledAt: existing.scheduledAt ?? null };
  const next = TaskSchema.parse({ ...base, scheduledAt: null, updatedAt });
  return putTask(next);
}

export async function createChildTask(parentId: string, title: string, now: Date = new Date()): Promise<Task> {
  const createdAt = now.toISOString();
  let created: Task | null = null;

  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    const parent = await db.tasks.get(parentId);
    if (!parent) throw new Error("PARENT_NOT_FOUND");
    if ((parent.parentId ?? null) !== null) throw new Error("CANNOT_NEST_BEYOND_ONE_LEVEL");

    const task = TaskSchema.parse({
      id: uuid(),
      parentId,
      title: normalizeTitle(title),
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      turn: null,
      turnAt: null,
      completedAt: null,
      tags: [],
      sortOrder: await nextChildSortOrder(parentId),
      createdAt,
      updatedAt: createdAt,
    });

    await db.tasks.add(task);
    await recordSyncLog("tasks", task.id, "create", task.updatedAt);
    created = task;
  });

  if (!created) throw new Error("PARENT_NOT_FOUND");
  return created;
}

export async function promoteToRoot(
  taskId: string,
  targetPool: "today" | "inbox",
  sortOrder: number,
  now: Date = new Date(),
): Promise<Task> {
  const existing = await db.tasks.get(taskId);
  if (!existing) throw new Error("任务不存在");

  const updatedAt = now.toISOString();
  const scheduledAt = targetPool === "today" ? localDateOf(now) : null;
  const next = TaskSchema.parse({
    ...existing,
    parentId: null,
    scheduledAt,    completedCount: existing.completedCount ?? 0,
    completedAt: existing.completedAt ?? null,
    tags: existing.tags ?? [],
    sortOrder,
    updatedAt,
  });
  return putTask(next);
}

export async function moveTaskToParent(
  taskId: string,
  newParentId: string,
  sortOrder: number,
  now: Date = new Date(),
): Promise<Task> {
  const updatedAt = now.toISOString();
  let moved: Task | null = null;

  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    const [task, parent] = await Promise.all([db.tasks.get(taskId), db.tasks.get(newParentId)]);
    if (!task) throw new Error("任务不存在");
    if (!parent || taskId === newParentId || (parent.parentId ?? null) !== null) {
      throw new Error("CANNOT_NEST_BEYOND_ONE_LEVEL");
    }

    if ((task.parentId ?? null) === null) {
      const childCount = await db.tasks.where("parentId").equals(taskId).count();
      if (childCount > 0) throw new Error("CANNOT_DEMOTE_ROOT_WITH_CHILDREN");
    }

    const next = TaskSchema.parse({
      ...task,
      parentId: newParentId,
      completedCount: task.completedCount ?? 0,
      completedAt: task.completedAt ?? null,
      tags: task.tags ?? [],
      sortOrder,
      updatedAt,
    });

    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", next.updatedAt);
    moved = next;
  });

  if (!moved) throw new Error("任务不存在");
  return moved;
}

export async function deleteTask(id: string): Promise<void> {
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await db.tasks.delete(id);
    await recordSyncLog("tasks", id, "delete");
  });
}

export async function deleteTaskCascade(taskId: string): Promise<void> {
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    const children = await db.tasks.where("parentId").equals(taskId).toArray();
    const ids = [taskId, ...children.map((child) => child.id)];
    await db.tasks.bulkDelete(ids);
    for (const id of ids) {
      await recordSyncLog("tasks", id, "delete");
    }
  });
}

export interface TodoBuckets {
  today: Task[]; // 含过期，过期排前
  inbox: Task[];
  scheduled: Task[]; // 一次性未来排期 + 未到期重复，按当前到期日升序
  recurring: Task[]; // 全部重复任务（去重桶）
  completed: Task[]; // 全部已完成（今天 + 隔日）+ 耗尽重复，按 completedAt 倒序
}

function isOverdue(t: Task, now: Date): boolean {
  const p = placementForTask(t, now);
  return p.pool === "today" && p.overdue;
}

/**
 * 已排期排序键：统一基于"系统本地日历"，与 placement.ts 的 localDayIndex 同口径，
 * 避免一次性任务用 APP_TIME_ZONE（getDateString）与重复任务用 dayToLocalYmd（系统本地）
 * 混排时在跨夜边界出现非确定性顺序。一次性任务进 pool==="upcoming" 时 scheduledAt 必非空，
 * 这里不做 `?? now` 兜底（placement 已保证）。
 */
function scheduledDateKey(t: Task, now: Date): string {
  if (t.recurrence) return currentDueDateString(t.recurrence, t.lastDoneAt, t.startAt, now);
  const d = new Date(t.scheduledAt as string);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function listTasks(now: Date = new Date()): Promise<TodoBuckets> {
  const rows = await db.tasks.orderBy("sortOrder").toArray();
  const all: Task[] = [];
  for (const row of rows) {
    const parsed = TaskSchema.safeParse(row);
    if (!parsed.success) {
      console.warn(`[tasks] dropping invalid local task ${(row as { id?: string }).id ?? "?"}:`, parsed.error.issues);
      continue;
    }
    all.push(parsed.data);
  }
  const buckets: TodoBuckets = { today: [], inbox: [], scheduled: [], recurring: [], completed: [] };
  for (const t of all) {
    if ((t.parentId ?? null) !== null) continue;
    if (t.recurrence) buckets.recurring.push(t);
    const p = placementForTask(t, now);
    if (p.pool === "today") buckets.today.push(t);
    else if (p.pool === "inbox") buckets.inbox.push(t);
    else if (p.pool === "upcoming") buckets.scheduled.push(t);
    else if (p.pool === "recurring") buckets.scheduled.push(t); // 未到期重复
    else buckets.completed.push(t); // pool === "completed"：所有已完成 + 耗尽重复
  }
  buckets.today.sort((a, b) => Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || a.sortOrder - b.sortOrder);
  buckets.scheduled.sort((a, b) => scheduledDateKey(a, now).localeCompare(scheduledDateKey(b, now)));
  buckets.completed.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return buckets;
}
