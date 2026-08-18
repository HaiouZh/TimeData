import {
  isRuleExhausted,
  latestOccurrenceForRule,
  materializeDue,
  materializeOccurrence,
  nextDueDate,
  type Recurrence,
  type Session,
  type Task,
  type TaskDeleteReason,
  TaskSchema,
} from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";
import { assignProjectTints } from "./contentTint.js";
import { getActiveSession } from "./sessions.js";
import { occurrenceChildId } from "./tasks/occurrenceChildId.js";
import { completionOp } from "./tasks/completionOp.js";
import {
  buildTodoProjectGroups,
  goalLinkedTaskIds,
  projectMemberIndex,
  type TodoProjectGroup,
} from "./tasks/goalMembership.js";
import {
  buildBlockedByIndex,
  listTaskRelations,
  removeTaskRelationsForInCurrentTransaction,
} from "./taskRelations.js";
import { localDateOf, normalizeScheduledDate, placementForTask } from "./tasks/placement.js";
import { sortProjectMembers } from "./tasks/projectZone.js";
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
    const prev = await db.tasks.get(next.id);
    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", next.updatedAt, completionOp(prev, next, next.updatedAt));
  });
  return next;
}

async function deleteTaskAndChildrenInCurrentTransaction(
  taskId: string,
  reason: TaskDeleteReason,
): Promise<void> {
  const children = await db.tasks.where("parentId").equals(taskId).toArray();
  const childReason: TaskDeleteReason = reason === "user" ? "cascade" : reason;
  const ids = [taskId, ...children.map((child) => child.id)];
  for (const id of ids) {
    await removeTaskRelationsForInCurrentTransaction({ kind: "task", id });
  }
  await db.tasks.bulkDelete(ids);
  await recordSyncLog("tasks", taskId, "delete", undefined, undefined, reason);
  for (const child of children) {
    await recordSyncLog("tasks", child.id, "delete", undefined, undefined, childReason);
  }
}

/** 事务内删除某 rule 名下所有活跃 pending occurrence（done=false && skipped=false）。仅在调用方事务内使用。 */
async function deleteActiveOccurrencesInCurrentTransaction(ruleId: string): Promise<void> {
  const stale = (await db.tasks.where("ruleId").equals(ruleId).toArray()).filter((o) => !o.done && !o.skipped);
  for (const o of stale) {
    await deleteTaskAndChildrenInCurrentTransaction(o.id, "occurrence");
  }
}

function materializeOccurrenceChildren(occurrence: Task, templateChildren: Task[]): Task[] {
  return templateChildren.map((child, index) =>
    TaskSchema.parse({
      id: occurrenceChildId(occurrence.id, child.id),
      parentId: occurrence.id,
      title: child.title,
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: child.tags ?? [],
      ruleId: null,
      skipped: false,
      sortOrder: index,
      createdAt: occurrence.createdAt,
      updatedAt: occurrence.updatedAt,
    }),
  );
}

async function ensureOccurrenceChildrenInCurrentTransaction(rule: Task, occurrence: Task): Promise<void> {
  const templateChildren = await db.tasks.where("parentId").equals(rule.id).sortBy("sortOrder");
  if (templateChildren.length === 0) return;

  const existing = await db.tasks.where("parentId").equals(occurrence.id).toArray();
  const existingIds = new Set(existing.map((child) => child.id));
  const missing = materializeOccurrenceChildren(occurrence, templateChildren).filter(
    (child) => !existingIds.has(child.id),
  );
  for (const child of missing) {
    await db.tasks.add(child);
    await recordSyncLog("tasks", child.id, "create", child.updatedAt);
  }
}

async function materializeRuleInCurrentTransaction(rule: Task, now: Date): Promise<void> {
  if (rule.recurrence === null || (rule.parentId ?? null) !== null) return;
  const forRule = await db.tasks.where("ruleId").equals(rule.id).toArray();
  const active = forRule.find((o) => !o.done && !o.skipped);
  // children 只在 occurrence 创建事务内克隆一次：引擎分不清「没同步到」和「用户刚删」，
  // 每轮补齐会把用户删掉的子步骤原样补回（#5.2）。
  if (active) return;

  const processed = forRule.filter((o) => o.done || o.skipped);
  const occ = materializeDue(rule, processed, now, await nextTaskSortOrder());
  if (occ == null) return;
  await db.tasks.add(occ);
  await recordSyncLog("tasks", occ.id, "create", occ.updatedAt);
  await ensureOccurrenceChildrenInCurrentTransaction(rule, occ);
}

async function materializeNextRuleOccurrenceInCurrentTransaction(rule: Task, now: Date): Promise<Task | null> {
  if (rule.recurrence === null || (rule.parentId ?? null) !== null) return null;
  const forRule = await db.tasks.where("ruleId").equals(rule.id).toArray();
  const active = forRule.find((o) => !o.done && !o.skipped);
  if (active) return active;

  const dueDate = nextDueDate(
    rule,
    forRule.filter((o) => o.done || o.skipped),
    now,
  );
  if (dueDate == null) return null;

  const occurrence = materializeOccurrence(rule, dueDate, now, await nextTaskSortOrder());
  const existing = await db.tasks.get(occurrence.id);
  if (existing) {
    if (!existing.done && !existing.skipped) {
      return existing;
    }
    return null;
  }

  await db.tasks.add(occurrence);
  await recordSyncLog("tasks", occurrence.id, "create", occurrence.updatedAt);
  await ensureOccurrenceChildrenInCurrentTransaction(rule, occurrence);
  return occurrence;
}

async function completeNextRuleOccurrenceInCurrentTransaction(rule: Task, now: Date): Promise<Task | null> {
  const occurrence = await materializeNextRuleOccurrenceInCurrentTransaction(rule, now);
  if (occurrence == null || occurrence.done || occurrence.skipped) return null;

  const wasDue = occurrence.scheduledAt != null && occurrence.scheduledAt <= localDateOf(now);
  const updatedAt = now.toISOString();
  const next = TaskSchema.parse({ ...occurrence, done: true, completedAt: updatedAt, updatedAt });
  await db.tasks.put(next);
  await recordSyncLog("tasks", next.id, "update", next.updatedAt, completionOp(occurrence, next, next.updatedAt));
  if (wasDue) await materializeRuleInCurrentTransaction(rule, now);
  return next;
}

async function materializeNextForOccurrenceInCurrentTransaction(occurrence: Task, now: Date): Promise<void> {
  if (occurrence.ruleId === null) return;
  const rule = await db.tasks.get(occurrence.ruleId);
  if (!rule || rule.recurrence === null || (rule.parentId ?? null) !== null) return;
  await materializeRuleInCurrentTransaction(rule, now);
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
    // 改规则未显式给 startAt 时把锚推到当下：重锚=从今天重新开始，锚点前历史发不再计入账本（#4）。
    startAt: recurrence ? (patch.startAt ?? (recurrenceChanged ? updatedAt : (existing.startAt ?? updatedAt))) : null,
    scheduledAt: existing.scheduledAt ?? null,
    completedCount: recurrence ? (resetRecurrenceProgress ? 0 : (existing.completedCount ?? 0)) : 0,
    sortOrder: patch.sortOrder ?? existing.sortOrder,
    updatedAt,
  });

  if (!resetRecurrenceProgress) return putTask(next);
  // 重锚：删该 rule 当前活跃 pending occurrence（同事务）+ put 模板
  await db.transaction("rw", db.tasks, db.taskRelations, db.syncLog, async () => {
    await deleteActiveOccurrencesInCurrentTransaction(id);
    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", next.updatedAt, completionOp(existing, next, next.updatedAt));
    await materializeRuleInCurrentTransaction(next, now);
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
  const now = options.now ?? new Date();
  const updatedAt = now.toISOString();
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
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", next.updatedAt, completionOp(existing, next, next.updatedAt));
    await materializeNextForOccurrenceInCurrentTransaction(next, now);
  });
  return next;
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
      await materializeRuleInCurrentTransaction(freshRule, now);
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
  await db.transaction("rw", db.tasks, db.taskRelations, db.syncLog, async () => {
    await deleteActiveOccurrencesInCurrentTransaction(id);
    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", next.updatedAt, completionOp(existing, next, next.updatedAt));
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
    scheduledAt: existing.scheduledAt ?? null,
    completedCount: existing.completedCount ?? 0,
    completedAt: existing.completedAt ?? null,
    tags: existing.tags ?? [],
  };

  const parentId = base.parentId ?? null;
  if (parentId !== null) {
    const parent = await db.tasks.get(parentId);
    if (parent?.recurrence !== null && parent?.recurrence !== undefined) {
      let result: Task = TaskSchema.parse(base);
      await db.transaction("rw", db.tasks, db.syncLog, async () => {
        const occurrences = await db.tasks.where("ruleId").equals(parent.id).toArray();
        const latest = latestOccurrenceForRule(parent.id, occurrences);
        if (latest == null) return;

        const targetId = occurrenceChildId(latest.id, base.id);
        const existingTarget = await db.tasks.get(targetId);
        if (existingTarget) {
          const completedAt = existingTarget.done ? null : updatedAt;
          const next = TaskSchema.parse({ ...existingTarget, done: !existingTarget.done, completedAt, updatedAt });
          await db.tasks.put(next);
          await recordSyncLog("tasks", next.id, "update", next.updatedAt, completionOp(existingTarget, next, next.updatedAt));
          result = next;
          return;
        }

        const next = TaskSchema.parse({
          ...base,
          id: targetId,
          parentId: latest.id,
          done: true,
          recurrence: null,
          lastDoneAt: null,
          startAt: null,
          scheduledAt: null,
          completedCount: 0,
          completedAt: updatedAt,
          ruleId: null,
          skipped: false,
          updatedAt,
          createdAt: updatedAt,
        });
        await db.tasks.add(next);
        await recordSyncLog("tasks", next.id, "create", next.updatedAt, completionOp(undefined, next, next.updatedAt));
        result = next;
      });
      return result;
    }

    const completedAt = base.done ? null : updatedAt;
    const next = TaskSchema.parse({ ...base, done: !base.done, completedAt, updatedAt });
    return putTask(next);
  }

  // 非重复且当前已完成 → 翻回未完成；重复任务的勾选只表示“完成一次”，不走撤销。
  if (!base.recurrence && base.done) {
    const reopened = TaskSchema.parse({ ...base, done: false, completedAt: null, updatedAt });
    if (base.ruleId === null) return putTask(reopened);
    // 撤勾 occurrence：删同 rule 后来物化的 active 发（它是这发完成的推进产物），避免双 active。
    await db.transaction("rw", db.tasks, db.taskRelations, db.syncLog, async () => {
      const others = (await db.tasks.where("ruleId").equals(base.ruleId as string).toArray()).filter(
        (o) => o.id !== base.id && !o.done && !o.skipped,
      );
      for (const o of others) {
        await deleteTaskAndChildrenInCurrentTransaction(o.id, "occurrence");
      }
      await db.tasks.put(reopened);
      await recordSyncLog("tasks", reopened.id, "update", reopened.updatedAt, completionOp(base, reopened, reopened.updatedAt));
    });
    return reopened;
  }

  if (!base.recurrence && base.ruleId !== null) {
    const next = TaskSchema.parse({ ...base, done: true, completedAt: updatedAt, updatedAt });
    await db.transaction("rw", db.tasks, db.syncLog, async () => {
      await db.tasks.put(next);
      await recordSyncLog("tasks", next.id, "update", next.updatedAt, completionOp(base, next, next.updatedAt));
      await materializeNextForOccurrenceInCurrentTransaction(next, now);
    });
    return next;
  }

  // 重复模板 root：完成语义代理到「最新那一发」——有 active 就完成它（复用 occurrence 分支，
  // 含完成后即时物化下一发）；无 active 先补到期发，仍无则按 nextDueDate 强制物化下一发。
  // 引擎判耗尽时 no-op；提前完成只开放给 client 人工入口，server agent 仍保持未到期 409。
  // 模板本体不承载完成态，旧 completeTask 衍生/终结转化路径已退役（§9.2）。
  if (base.recurrence) {
    let completed: Task | null = null;
    await db.transaction("rw", db.tasks, db.syncLog, async () => {
      const rule = await db.tasks.get(base.id);
      if (!rule || rule.recurrence === null || (rule.parentId ?? null) !== null) return;
      completed = await completeNextRuleOccurrenceInCurrentTransaction(rule, now);
    });
    if (completed) return completed;
    return TaskSchema.parse(base);
  }

  // 普通池任务（无 recurrence、无 ruleId、未完成）：直接完成。
  const next = TaskSchema.parse({ ...base, done: true, completedAt: updatedAt, updatedAt });
  return putTask(next);
}

export async function scheduleTask(id: string, date: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");
  if (existing.recurrence) throw new Error("重复任务不通过排期接口修改，请改重复规则");
  // occurrence（重复规则的「这一发」）不走通用排期通道：这里的 scheduledAt 同时是账本的应发生日游标，
  // 挪它会把整条规则的推进游标带歪。给单发改期是另一个动词（未来做，需要与应发生日解耦），不是这个。
  if (existing.ruleId !== null) throw new Error("重复任务的这一发不通过排期通道改期");
  const updatedAt = (options.now ?? new Date()).toISOString();
  const base = { ...existing, scheduledAt: existing.scheduledAt ?? null };
  const next = TaskSchema.parse({ ...base, scheduledAt: normalizeScheduledDate(date), updatedAt });
  return putTask(next);
}

export async function unscheduleTask(id: string, options: { now?: Date } = {}): Promise<Task> {
  const existing = await db.tasks.get(id);
  if (!existing) throw new Error("任务不存在");
  if (existing.recurrence) throw new Error("重复任务不能删除排期");
  // occurrence 清排期会造出 scheduledAt=null 的僵尸发：placement 先按 null 落 inbox（回不到 today），
  // 而引擎仍视其为 active，整条规则再不产下一发。不受理；不想做这一发请用「跳过」。
  if (existing.ruleId !== null) throw new Error("重复任务的这一发不能清排期，不想做请跳过");
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
    scheduledAt,
    completedCount: existing.completedCount ?? 0,
    completedAt: existing.completedAt ?? null,
    tags: existing.tags ?? [],
    sortOrder,
    updatedAt,
  });
  return putTask(next);
}

/**
 * 降级为子任务的事务内原语。**必须在已开启的 rw 事务内调用**（事务表须含 tasks / syncLog）。
 *
 * 写回时 `sessionId` 恒置空：子任务不持有任何归属指针。不清的话，一条已变成子步骤的活
 * 会继续被 listResumableSessions 算进「这个场还有 N 条未完」（它按 sessionId 直查、不排除
 * 子任务），散场后还会被 resumeSession 批量迁到新场。
 */
export async function moveTaskToParentInCurrentTransaction(
  taskId: string,
  newParentId: string,
  now: Date = new Date(),
): Promise<Task> {
  const updatedAt = now.toISOString();
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
    sessionId: null,
    completedCount: task.completedCount ?? 0,
    completedAt: task.completedAt ?? null,
    tags: task.tags ?? [],
    sortOrder: await nextChildSortOrder(newParentId),
    updatedAt,
  });

  await db.tasks.put(next);
  await recordSyncLog("tasks", next.id, "update", next.updatedAt);
  return next;
}

/**
 * 把任务移动成 `newParentId` 的子任务，**追加到目标父现有 children 末尾**（`nextChildSortOrder`
 * 取 max+1，得到一个目标作用域内不撞值的 sortOrder）。不接收外部 sortOrder——历史上调用方一律塞
 * 0，致同父多个 child 撞同值、连累重排失效（见 `reorderChildren`），由函数自管落位根除此源。
 *
 * 只改父子与手头场指针，**不碰项目归属**。用户视角的「收纳」要走 taskNesting.nestTaskUnderParent。
 */
export async function moveTaskToParent(taskId: string, newParentId: string, now: Date = new Date()): Promise<Task> {
  let moved: Task | null = null;
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    moved = await moveTaskToParentInCurrentTransaction(taskId, newParentId, now);
  });
  if (!moved) throw new Error("任务不存在");
  return moved;
}

export async function deleteTask(id: string): Promise<void> {
  await db.transaction("rw", db.tasks, db.taskRelations, db.syncLog, async () => {
    await removeTaskRelationsForInCurrentTransaction({ kind: "task", id });
    await db.tasks.delete(id);
    await recordSyncLog("tasks", id, "delete", undefined, undefined, "user");
  });
}

export async function deleteTaskCascade(taskId: string): Promise<void> {
  await db.transaction("rw", db.tasks, db.taskRelations, db.syncLog, async () => {
    const task = await db.tasks.get(taskId);

    // 删规则：连清其名下活跃 pending occurrence（done/skipped 历史发留作账本事实）。
    if (task?.recurrence != null) {
      await deleteActiveOccurrencesInCurrentTransaction(taskId);
    }

    // 删模板子任务：连清活跃发里按确定性 id 物化的镜像子任务（done 历史发的不动）。
    if (task != null && (task.parentId ?? null) !== null) {
      const parent = await db.tasks.get(task.parentId as string);
      if (parent?.recurrence != null) {
        const actives = (await db.tasks.where("ruleId").equals(parent.id).toArray()).filter(
          (o) => !o.done && !o.skipped,
        );
        for (const occ of actives) {
          const mirrorId = occurrenceChildId(occ.id, taskId);
          if ((await db.tasks.get(mirrorId)) !== undefined) {
            await removeTaskRelationsForInCurrentTransaction({ kind: "task", id: mirrorId });
            await db.tasks.delete(mirrorId);
            await recordSyncLog("tasks", mirrorId, "delete", undefined, undefined, "mirror");
          }
        }
      }
    }

    await deleteTaskAndChildrenInCurrentTransaction(taskId, "user");
  });
}

/**
 * 归属变更后刷新任务 updatedAt。**必须在调用方已开启的事务内调用**，
 * 调用方的事务表清单须含 db.tasks 与 db.syncLog。
 *
 * 为什么必须刷新：重力沉降按 task.updatedAt 的年龄判定（tasks/gravity.ts 的 isTaskSunken）。
 * 任务失去项目归属会回落收件箱，不刷新就按旧时间戳参与水位线判定，久置任务直接沉进
 * 默认折叠的水下区——用户体感是「退出项目 = 任务消失」。
 *
 * 这是**本机副作用、不是跨设备不变量**：入站 sync apply 按域写单表、没有跨域钩子，
 * 其它设备改归属不会 touch 本机 task 行。所以项目区必须完全由 goals 推导，
 * 不得依赖 task 行上任何反向标记。
 */
export async function touchTasksInCurrentTransaction(taskIds: readonly string[], timestamp: string): Promise<void> {
  if (taskIds.length === 0) return;
  const existing = await db.tasks.bulkGet([...taskIds]);
  // 调用方（如 ownedProjectTaskIds）读的是未经 GoalSchema 校验的裸 goal 行，
  // members 里可能含重复 task ref（唯一性 superRefine 只在 parse 路径上跑）；
  // 去重避免 bulkUpdate 带重复 key、以及给同一条 task 记两条 syncLog。
  const present = [...new Set(existing.filter((row): row is Task => Boolean(row)).map((row) => row.id))];
  if (present.length === 0) return;
  await db.tasks.bulkUpdate(present.map((id) => ({ key: id, changes: { updatedAt: timestamp } })));
  for (const id of present) {
    await recordSyncLog("tasks", id, "update", timestamp);
  }
}

export interface TodoBuckets {
  today: Task[]; // 含过期，过期排前
  inbox: Task[];
  scheduled: Task[]; // 一次性未来排期 + 未到期重复，按当前到期日升序
  /** 水位线切点：scheduled 中第一个下一发生日超出「今天+7 天」的下标；全近期=length，空桶=0。 */
  scheduledSunkenFromIndex: number;
  recurring: Task[]; // P3 后 UI 不再单独渲染重复桶，保留空桶兼容旧调用方
  completed: Task[]; // 全部已完成（今天 + 隔日）+ 耗尽重复，按 completedAt 倒序
  /** 手头：活跃会话抓住的 root（含本场 done，按 sortOrder）；未完的不再进 today/inbox/scheduled。 */
  atHand: Task[];
  handSession: Session | null;
  /**
   * 手头未完的活总数 = 未完根任务 + 它们名下未完子任务。
   * **刻意与收件箱/今天区的根任务口径不同**：那两区是清单，数根任务合理；
   * 手头区是工作台，压成父子只是整理结构，活一件没少。别当 bug 改掉。
   */
  atHandPendingTotal: number;
  /**
   * 项目区：按 active project 目标分组的成员任务，组间按成员 max(updatedAt) 倒序。
   * 归属轴排他已打开——这些成员不再进 `inbox`，收件箱因此是「真·未归类托盘」。
   * 焦点轴与时间轴正交：被抓到手头 / 排了今天的成员**同时**出现在对应桶与本桶。
   */
  projects: TodoProjectGroup[];
  /**
   * goalId → 项目身份色 `var(--color-tint-N)`，供项目区组卡片与组外 chip 的圆点取色。
   *
   * **基于全部 active project 算，与「本次显示了哪些组」无关**：若只按 `projects`（有可解析
   * 成员的组）算，某个项目的成员全部完成后它离开显示集合、释放色位，会让别的项目跟着换色。
   * 排序键是 createdAt（新建项目排末尾 → 不影响已有项目的分配），机制见 `lib/contentTint.ts`。
   */
  projectTints: ReadonlyMap<string, string>;
  /**
   * 被任一 active 目标引用的 task id，**不看 kind**，喂行内绿竖条 `inGoal`。
   * 与 projects 的口径（只认 kind==="project"）不同，两者不得互相派生：
   * 若由 projects 派生，只属于 theme 目标的任务会失去绿竖条。
   */
  goalLinkedIds: ReadonlySet<string>;
  /** 在等：被未完成前置挡住的任务。已在手头或已完成的**不进**这里——正在做的活不该显示「在等」。 */
  waiting: Task[];
  /** taskId → 挡着它的那些东西的标题（用于界面显示「等 XX」）；悬空边仅保留占位，不参与分流。 */
  waitingBlockerTitles: Record<string, string[]>;
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
function scheduledDateKey(t: Task, now: Date, ruleDueKey?: Map<string, string>): string {
  // 重复模板：优先账本推进的下一到期日（listTasks 预计算）；无账本上下文时退回模板死游标（legacy 兜底）。
  if (t.recurrence) return ruleDueKey?.get(t.id) ?? currentDueDateString(t.recurrence, t.lastDoneAt, t.startAt, now);
  return localYmd(new Date(t.scheduledAt as string));
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * blockedBy 索引的 `${kind}:${id}` 键 → 界面显示的标题。悬空 ref（任务/轨道已删）退回占位，
 * 不因查不到就丢掉整条边——否则「在等」区会显示一条不说明原因的行。
 */
function blockerDisplayTitle(
  key: string,
  tasksById: Map<string, Task>,
  trackTitles: Map<string, string>,
): string {
  const sep = key.indexOf(":");
  const kind = key.slice(0, sep);
  const id = key.slice(sep + 1);
  if (kind === "task") return tasksById.get(id)?.title ?? "（已删除）";
  if (kind === "track") return trackTitles.get(id) ?? "（已删除）";
  return "（已删除）";
}

export async function listTasks(now: Date = new Date()): Promise<TodoBuckets> {
  const handSession = await getActiveSession();
  const handSessionId = handSession?.id ?? null;
  const atHand: Task[] = [];
  const rows = await db.tasks.orderBy("sortOrder").toArray();
  // 读裸行不做 GoalSchema 解析：superRefine 会因单个成员重复 reject 整行，让整组归属静默失效。
  // 这一读同时把 goals 表纳入 useLiveQuery 的依赖追踪，TodoPage 不必再单开一条 goals 查询。
  const goalRows = await db.goals.toArray();
  // 关系边（谁挡着谁）同层读入：新增/删除边要即时重算 waiting 桶，
  // 经 listTaskRelations 的 db.taskRelations 访问纳入 liveQuery 依赖追踪。
  const relations = await listTaskRelations();
  const projectIndex = projectMemberIndex(goalRows);
  const projectCandidates: Task[] = [];
  const all: Task[] = [];
  for (const row of rows) {
    const parsed = TaskSchema.safeParse(row);
    if (!parsed.success) {
      console.warn(`[tasks] dropping invalid local task ${(row as { id?: string }).id ?? "?"}:`, parsed.error.issues);
      continue;
    }
    all.push(parsed.data);
  }
  // 前置已完成的判定「一勾自动解锁」落在 buildBlockedByIndex 里（已完成的 blocker 不进索引），
  // 这里只负责喂 completedKeys。轨道已完成 = status !== "active"；tracks 表本函数此前不读，
  // 这一读让轨道完成/删除即时反映到 waiting 桶的解锁与标题。悬空 ref 的标题回退见 blockerDisplayTitle。
  const tasksById = new Map(all.map((t) => [t.id, t] as const));
  const completedKeys = new Set<string>();
  // 存活端点：悬空 blocker 不算挡（见 buildBlockedByIndex 的注释）。与 completedKeys 同一轮遍历，
  // 不另开循环——两者的口径必须来自同一份 all/trackRows，分开取会在并发刷新时错位。
  const liveKeys = new Set<string>();
  for (const t of all) {
    liveKeys.add(`task:${t.id}`);
    if (t.done) completedKeys.add(`task:${t.id}`);
  }
  const trackRows = await db.tracks.toArray();
  const trackTitles = new Map<string, string>();
  for (const tr of trackRows) {
    trackTitles.set(tr.id, tr.title);
    liveKeys.add(`track:${tr.id}`);
    if (tr.status !== "active") completedKeys.add(`track:${tr.id}`);
  }
  const blockedBy = buildBlockedByIndex(relations, completedKeys, liveKeys);
  // 「谁被谁挡着、挡它的叫什么」只算一份，「在等」区胶囊与项目组两个消费方共用。
  // 提前算（而不是在下面的 waiting 分支里现算）是为了覆盖到**被挡且在手头**的成员——
  // 那一类在更早的 atHand 分支就 continue 了，永远走不到 waiting 分支，此前它有 id 却没有标题。
  const blockedTitlesByTaskId = new Map<string, string[]>();
  for (const t of all) {
    const keys = blockedBy.get(`task:${t.id}`);
    if (keys === undefined) continue;
    blockedTitlesByTaskId.set(
      t.id,
      keys.map((key) => blockerDisplayTitle(key, tasksById, trackTitles)),
    );
  }
  const buckets: TodoBuckets = {
    today: [],
    inbox: [],
    scheduled: [],
    recurring: [],
    completed: [],
    scheduledSunkenFromIndex: 0,
    atHand,
    atHandPendingTotal: 0,
    handSession,
    projects: [],
    // 裸行取 createdAt 要兜 undefined（老行可能缺字段）；createdAt 并列时用 id 兜稳定序。
    projectTints: assignProjectTints(
      goalRows
        .filter((row) => row.status === "active" && row.kind === "project")
        .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id))
        .map((row) => row.id),
    ),
    goalLinkedIds: goalLinkedTaskIds(goalRows),
    waiting: [],
    waitingBlockerTitles: {},
  };
  for (const relation of relations) {
    const blockerKey = `${relation.blockerKind}:${relation.blockerId}`;
    if (liveKeys.has(blockerKey)) continue;
    if (relation.blockedKind !== "task") continue;
    const titles = buckets.waitingBlockerTitles[relation.blockedId] ?? [];
    buckets.waitingBlockerTitles[relation.blockedId] = [
      ...titles,
      blockerDisplayTitle(blockerKey, tasksById, trackTitles),
    ];
  }
  // 规则的耗尽判定与到期日排序统一走 occurrence 账本（§9.1 读口径），不再读模板死游标。
  const occurrencesByRule = new Map<string, Task[]>();
  for (const t of all) {
    if (t.ruleId === null) continue;
    const list = occurrencesByRule.get(t.ruleId);
    if (list) list.push(t);
    else occurrencesByRule.set(t.ruleId, [t]);
  }
  const ruleDueKey = new Map<string, string>();
  for (const t of all) {
    const isChild = (t.parentId ?? null) !== null;
    // 阶段3：子任务不再整行跳过。它可以带排期进 today/scheduled、被抓进手头，
    // 但**无排期时不进 inbox**——收件箱是「真·未归类托盘」，子任务已有归属（属于某个父任务），
    // 与下方「已归 active project 的根任务不进收件箱」同构。
    // 发次镜像子任务不独立进桶。**当前实现下这是纯防御、没有活路径也没有测试守卫**：
    // 两条物化路径（materializeOccurrenceChildren、toggleTaskDone 的镜像分支）都写
    // ruleId=null，产品里造不出 parentId 与 ruleId 同时非空的行；删掉这行测试全绿。
    // 保留是因为那是当前实现的巧合而非不变量——哪天某条路径改成给镜像子步写 ruleId，
    // 没有这行它们就会各自独立涌进分桶。**试过给它补守卫用例，造出的行走不到这个分支、
    // 补出来是假闸，已按「假闸比没有闸更坏」删掉并记 backlog。**
    if (isChild && t.ruleId !== null) continue;
    if (t.ruleId !== null && t.skipped) continue; // skipped occurrence 不进活跃桶
    // 项目区归集必须早于下面手头的 `continue`：被抓到手头的成员仍要出现在项目区
    // （焦点轴与归属轴正交，缺了正在干的那几条就是残废视图）。
    // 已归项目的子任务随放宽早退纳入归集候选；重复模板与 occurrence 本期不参与归属。
    //
    // 这个布尔量同时是归集判据与**排他判据**，两者必须同源：若排他单独用 projectIndex.has(t.id)，
    // 一条被写进 members 的 occurrence 会既进不了项目区（被本行的守卫挡住）、又被踢出 inbox，
    // 在页面上彻底消失。
    const ownedByProject = t.recurrence === null && t.ruleId === null && projectIndex.has(t.id);
    if (ownedByProject) projectCandidates.push(t);
    if (handSessionId !== null && t.recurrence === null && (t.sessionId ?? null) === handSessionId) {
      atHand.push(t);
      if (!t.done) continue; // 未完只在手头；done 继续走 placement 落 completed（战果双显）
    }
    if (t.recurrence) {
      const occurrences = occurrencesByRule.get(t.id) ?? [];
      if (isRuleExhausted(t, occurrences)) {
        buckets.completed.push(t); // 账本判定耗尽的规则沉入完成区，不再僵在 scheduled
        continue;
      }
      ruleDueKey.set(t.id, nextDueDate(t, occurrences, now) ?? "9999-12-31");
      buckets.scheduled.push(t); // 重复模板退到 scheduled 管理区，不投影 today
      continue;
    }
    const p = placementForTask(t, now);
    if (p.pool === "completed") buckets.completed.push(t);
    // 在等：被未完成前置挡住。插在「已完成」之后、原 placement 分支之前——排了今天/已排期/无排期的
    // 被挡任务一律进 waiting，不再进 today/inbox/scheduled，用户不会在「今天」看到做不了的活。
    // 与判定层 bucketForTask 的优先级刻意不同（判定层「排了今天」优先于「被挡」）：判定层回答
    // 「这条活是什么状态」，分区回答「它该出现在哪个区」，两层口径不同。见 RESULT DECISIONS。
    else if (blockedBy.has(`task:${t.id}`)) {
      buckets.waiting.push(t);
      buckets.waitingBlockerTitles[t.id] = blockedTitlesByTaskId.get(t.id) ?? [];
    } else if (p.pool === "today") buckets.today.push(t);
    // 归属轴排他：已归 active project 的根任务不进收件箱，收件箱回归「真·未归类托盘」。
    else if (p.pool === "inbox") {
      if (!ownedByProject && !isChild) buckets.inbox.push(t);
    } else if (p.pool === "upcoming") buckets.scheduled.push(t);
    else if (p.pool === "recurring") buckets.scheduled.push(t);
    else buckets.completed.push(t); // pool === "completed"：所有已完成 + 耗尽重复
  }
  buckets.today.sort((a, b) => Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || a.sortOrder - b.sortOrder);
  buckets.scheduled.sort((a, b) => scheduledDateKey(a, now, ruleDueKey).localeCompare(scheduledDateKey(b, now, ruleDueKey)));
  // 水位线：下一发生日 ≤ 今天+7（本地日历，与排序键同口径）在水上，其余折叠为水下。
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 7);
  const horizonKey = localYmd(horizon);
  const sunkenFrom = buckets.scheduled.findIndex((t) => scheduledDateKey(t, now, ruleDueKey) > horizonKey);
  buckets.scheduledSunkenFromIndex = sunkenFrom === -1 ? buckets.scheduled.length : sunkenFrom;
  buckets.completed.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  // 项目区计数口径含子任务：按 parentId 建一份索引交给分组投影。与下方 atHandPendingTotal
  // 的反查同源——都从 all 里按 parentId 取，skipped 一律剔除（那是"删·跳"留痕，不是活）。
  const childrenByParent = new Map<string, Task[]>();
  for (const t of all) {
    const parentId = t.parentId ?? null;
    if (parentId === null || t.skipped) continue;
    const list = childrenByParent.get(parentId);
    if (list) list.push(t);
    else childrenByParent.set(parentId, [t]);
  }
  buckets.projects = buildTodoProjectGroups(
    goalRows,
    projectIndex,
    projectCandidates,
    now,
    childrenByParent,
    blockedTitlesByTaskId,
  ).map((group) => ({
    ...group,
    tasks: sortProjectMembers(group.tasks, {
      handSessionId,
      now,
      blockedIds: new Set(group.blockedByMember.keys()),
    }),
  }));
  // 手头区的「还有 N 条子任务」按 atHand 的根任务反查 children，不从桶里数。
  // （阶段3 之前的理由是「子任务被 parentId 早退整个丢掉、不在任何桶里」，那句已不成立：
  //  子任务现在进 today/scheduled/waiting/atHand。反查仍然是对的——桶里的子任务是按各自
  //  落点散开的，数不出「这个根任务名下还剩几条」。）
  const pendingRoots = atHand.filter((t) => !t.done);
  const pendingRootIds = new Set(pendingRoots.map((t) => t.id));
  const pendingChildCount = all.filter(
    (t) => !t.done && !t.skipped && t.parentId !== null && pendingRootIds.has(t.parentId),
  ).length;
  buckets.atHandPendingTotal = pendingRoots.length + pendingChildCount;
  return buckets;
}
