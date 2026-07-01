import { completeTask, materializeDue, type Recurrence, type Task, TaskSchema } from "@timedata/shared";
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
  tags?: string[];
  now?: Date;
}

export interface UpdateTaskPatch {
  title?: string;
  recurrence?: Recurrence | null;
  startAt?: string | null;
  sortOrder?: number;
  now?: Date;
}

export function normalizeTaskTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("任务标题不能为空");
  return trimmed;
}

export async function nextTaskSortOrder(): Promise<number> {
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

/** 事务内删除某 rule 名下所有活跃 pending occurrence（done=false && skipped=false）。仅在调用方事务内使用。 */
async function deleteActiveOccurrencesInCurrentTransaction(ruleId: string): Promise<void> {
  const stale = (await db.tasks.where("ruleId").equals(ruleId).toArray()).filter((o) => !o.done && !o.skipped);
  for (const o of stale) {
    await db.tasks.delete(o.id);
    await recordSyncLog("tasks", o.id, "delete");
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export async function addTask(input: AddTaskInput): Promise<Task> {
  const task = await buildNewRootTask(input);

  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await insertNewTaskInCurrentTransaction(task);
  });
  return task;
}

export async function buildNewRootTask(input: AddTaskInput): Promise<Task> {
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
    tags: input.tags ?? [],
    title: normalizeTaskTitle(input.title),
    done: false,
    recurrence,
    lastDoneAt: null,
    startAt: recurrence ? (input.startAt ?? createdAt) : null,
    scheduledAt,
    completedCount: 0,
    completedAt: null,
    sortOrder: await nextTaskSortOrder(),
    createdAt,
    updatedAt: createdAt,
  });

  return task;
}

export async function insertNewTaskInCurrentTransaction(task: Task): Promise<void> {
  await db.tasks.add(task);
  await recordSyncLog("tasks", task.id, "create", task.updatedAt);
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
 * 再把新次序回填成连续的 0..n-1。
 *
 * 子任务 sortOrder 是 per-parent 的独立空间（始终按 parentId 取后单独排），故直接回填 0..n-1
 * 安全，且能自愈历史脏数据：move-to-parent 曾固定塞 sortOrder=0、或跨端同步撞值时，多个子任务
 * 会共享同一 sortOrder——此时槽位回填式重排（persistTaskOrder）算不出任何变化、静默不写库，
 * 表现为"拖了不动"。连续回填则无论起始值是否撞值都能落库成真正不同的次序。只写实际变动的行；
 * 顺序未变（拖回原位）时短路不写。
 */
export async function reorderChildren(parentId: string, activeId: string, overId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    const children = await db.tasks.where("parentId").equals(parentId).sortBy("sortOrder");
    const ids = children.map((child) => child.id);
    const oldIndex = ids.indexOf(activeId);
    const newIndex = ids.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    const ordered = ids.slice();
    const [moved] = ordered.splice(oldIndex, 1);
    ordered.splice(newIndex, 0, moved);

    const byId = new Map(children.map((child) => [child.id, child]));
    const updates = ordered
      .map((id, index) => ({ child: byId.get(id), index }))
      .filter(
        (entry): entry is { child: Task; index: number } =>
          entry.child !== undefined && entry.child.sortOrder !== entry.index,
      );
    if (updates.length === 0) return;

    await db.tasks.bulkUpdate(
      updates.map(({ child, index }) => ({ key: child.id, changes: { sortOrder: index, updatedAt: now } })),
    );
    for (const { child } of updates) {
      await recordSyncLog("tasks", child.id, "update", now);
    }
  });
}

export async function updateTask(id: string, patch: UpdateTaskPatch): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");

  const now = patch.now ?? new Date();
  const updatedAt = now.toISOString();
  const recurrence = patch.recurrence === undefined ? existing.recurrence : patch.recurrence;
  const recurrenceChanged =
    patch.recurrence !== undefined && stableJson(patch.recurrence) !== stableJson(existing.recurrence);
  const startChanged = patch.startAt !== undefined && patch.startAt !== existing.startAt;
  const resetRecurrenceProgress = Boolean(recurrence && (recurrenceChanged || startChanged));
  const next: Task = TaskSchema.parse({
    ...existing,
    title: patch.title === undefined ? existing.title : normalizeTaskTitle(patch.title),
    recurrence,
    done: recurrence ? false : existing.done,
    lastDoneAt: recurrence ? (resetRecurrenceProgress ? null : existing.lastDoneAt) : null,
    startAt: recurrence ? (patch.startAt ?? existing.startAt ?? updatedAt) : null,
    scheduledAt: existing.scheduledAt ?? null,
    completedCount: recurrence ? (resetRecurrenceProgress ? 0 : (existing.completedCount ?? 0)) : 0,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
    updatedAt,
  });

  if (!resetRecurrenceProgress) return putTask(next);
  // 重锚：删该 rule 当前活跃 pending occurrence（同事务）+ put 模板
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await deleteActiveOccurrencesInCurrentTransaction(id);
    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", next.updatedAt);
  });
  return next;
}

export async function setTaskTags(id: string, tags: string[], options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");

  const updatedAt = (options.now ?? new Date()).toISOString();
  const next = TaskSchema.parse({
    ...existing,
    scheduledAt: existing.scheduledAt ?? null,
    completedCount: existing.completedCount ?? 0,
    weight: existing.weight ?? 0,
    completedAt: existing.completedAt ?? null,
    tags,
    updatedAt,
  });
  return putTask(next);
}

export async function bumpTaskWeight(id: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");

  const updatedAt = (options.now ?? new Date()).toISOString();
  const next = TaskSchema.parse({
    ...existing,
    parentId: existing.parentId ?? null,
    scheduledAt: existing.scheduledAt ?? null,
    completedCount: existing.completedCount ?? 0,
    completedAt: existing.completedAt ?? null,
    tags: existing.tags ?? [],
    weight: (existing.weight ?? 0) + 1,
    updatedAt,
  });
  return putTask(next);
}

/** occurrence 删·跳：置 skipped=true 留痕（不删行），让 P2 游标能前进。仅对 occurrence（ruleId 非空、recurrence null）有效。 */
export async function markOccurrenceSkipped(id: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");
  if (existing.ruleId === null || existing.recurrence !== null) throw new Error("只有 occurrence 可跳过");
  const updatedAt = (options.now ?? new Date()).toISOString();
  const next = TaskSchema.parse({
    ...existing,
    parentId: existing.parentId ?? null,
    scheduledAt: existing.scheduledAt ?? null,
    completedCount: existing.completedCount ?? 0,
    completedAt: existing.completedAt ?? null,
    tags: existing.tags ?? [],
    skipped: true,
    updatedAt,
  });
  return putTask(next);
}

let materializationInFlight: Promise<void> | null = null;

/** 遍历所有重复规则，对没有活跃 pending occurrence 的 rule 物化当前该做的一条到库。并发调用合并为同一个 in-flight Promise。 */
export async function runMaterialization(now: Date = new Date()): Promise<void> {
  if (materializationInFlight) return materializationInFlight;
  materializationInFlight = runMaterializationOnce(now).finally(() => {
    materializationInFlight = null;
  });
  return materializationInFlight;
}

async function runMaterializationOnce(now: Date): Promise<void> {
  const rules = await db.tasks.filter((t) => t.recurrence !== null && (t.parentId ?? null) === null).toArray();
  for (const rule of rules) {
    await db.transaction("rw", db.tasks, db.syncLog, async () => {
      const freshRule = await db.tasks.get(rule.id);
      if (!freshRule || freshRule.recurrence === null || (freshRule.parentId ?? null) !== null) return;
      const forRule = await db.tasks.where("ruleId").equals(freshRule.id).toArray();
      if (forRule.some((o) => !o.done && !o.skipped)) return; // 同时只一条活跃
      const processed = forRule.filter((o) => o.done || o.skipped);
      const occ = materializeDue(freshRule, processed, now, await nextTaskSortOrder());
      if (occ == null) return;
      await db.tasks.add(occ);
      await recordSyncLog("tasks", occ.id, "create", occ.updatedAt);
    });
  }
}

export async function applyRecurrenceChoice(
  id: string,
  choice: RecurrenceChoice,
  options: { now?: Date } = {},
): Promise<Task> {
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
    scheduledAt: choice.kind === "scheduled" ? normalizeScheduledDate(choice.date) : null,
    completedCount: 0,
    updatedAt,
  });

  // none/scheduled：rule 不再吐 occurrence，同事务清掉其名下活跃 pending
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await deleteActiveOccurrencesInCurrentTransaction(id);
    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", next.updatedAt);
  });
  return next;
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
    occurrenceSortOrder: await nextTaskSortOrder(),
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
      title: normalizeTaskTitle(title),
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
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

/**
 * 把任务移动成 `newParentId` 的子任务，**追加到目标父现有 children 末尾**（`nextChildSortOrder`
 * 取 max+1，得到一个目标作用域内不撞值的 sortOrder）。不接收外部 sortOrder——历史上调用方一律塞
 * 0，致同父多个 child 撞同值、连累重排失效（见 `reorderChildren`），由函数自管落位根除此源。
 */
export async function moveTaskToParent(taskId: string, newParentId: string, now: Date = new Date()): Promise<Task> {
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
      sortOrder: await nextChildSortOrder(newParentId),
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
  recurring: Task[]; // P3 后 UI 不再单独渲染重复桶，保留空桶兼容旧调用方
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
    if (t.ruleId !== null && t.skipped) continue; // skipped occurrence 不进活跃桶
    if (t.recurrence) {
      buckets.scheduled.push(t); // 重复模板退到 scheduled 管理区，不投影 today
      continue;
    }
    const p = placementForTask(t, now);
    if (p.pool === "today") buckets.today.push(t);
    else if (p.pool === "inbox") buckets.inbox.push(t);
    else if (p.pool === "upcoming") buckets.scheduled.push(t);
    else if (p.pool === "recurring") buckets.scheduled.push(t);
    else buckets.completed.push(t); // pool === "completed"：所有已完成 + 耗尽重复
  }
  buckets.today.sort((a, b) => Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || a.sortOrder - b.sortOrder);
  buckets.scheduled.sort((a, b) => scheduledDateKey(a, now).localeCompare(scheduledDateKey(b, now)));
  buckets.completed.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return buckets;
}
