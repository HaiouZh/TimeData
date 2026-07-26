import { GoalSchema, TaskSchema, TrackSchema, type Goal, type GoalMemberRef, type GoalPrerequisite, type Task, type Track } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import {
  deleteGoalLayoutPinsForGoalInCurrentTransaction,
  deleteGoalMemberPinInCurrentTransaction,
} from "./goalLayoutPins.js";
import { recordSyncLog } from "../sync/engine.js";
import {
  ownedProjectTaskIds,
  projectAssignBlock,
  projectAssignBlockMessage,
  projectMemberIndex,
  releasedProjectTaskIds,
  type ProjectAssignBlock,
} from "./tasks/goalMembership.js";
import { buildNewRootTask, insertNewTaskInCurrentTransaction, touchTasksInCurrentTransaction } from "./tasks.js";

export interface AddGoalInput {
  title: string;
  kind: Goal["kind"];
  note?: string;
  now?: Date;
}

export interface UpdateGoalPatch {
  title?: string;
  kind?: Goal["kind"];
  status?: Goal["status"];
  note?: string | null;
  members?: GoalMemberRef[];
  prerequisites?: GoalPrerequisite[];
  now?: Date;
}

export interface AddTaskForGoalInput {
  title: string;
  toInbox?: boolean;
  now?: Date;
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function trimRequired(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function warnInvalidGoal(row: unknown, issues: unknown): void {
  const id = typeof row === "object" && row !== null && "id" in row ? String(row.id) : "?";
  console.warn(`[goals] dropping invalid local goal ${id}:`, issues);
}

function byGoalOrder(a: Goal, b: Goal): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function omitGoalNote(goal: Goal): Goal {
  const { note: _note, ...rest } = goal;
  return rest;
}

function sameGoalMember(left: GoalMemberRef, right: GoalMemberRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

export async function addGoal(input: AddGoalInput): Promise<Goal> {
  const createdAt = nowIso(input.now);
  const candidate = {
    id: uuid(),
    title: trimRequired(input.title, "目标标题不能为空"),
    kind: input.kind,
    status: "active",
    members: [],
    prerequisites: [],
    createdAt,
    updatedAt: createdAt,
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  const goal = GoalSchema.parse(candidate);

  await db.transaction("rw", db.goals, db.syncLog, async () => {
    await db.goals.add(goal);
    await recordSyncLog("goals", goal.id, "create", goal.updatedAt);
  });

  return goal;
}

export async function updateGoal(id: string, patch: UpdateGoalPatch): Promise<Goal> {
  const existing = await db.goals.get(id);
  if (!existing) throw new Error("目标不存在");

  let candidate: Goal = {
    ...existing,
    members: existing.members ?? [],
    prerequisites: existing.prerequisites ?? [],
    updatedAt: nowIso(patch.now),
  };
  if (patch.title !== undefined) candidate.title = trimRequired(patch.title, "目标标题不能为空");
  if (patch.kind !== undefined) candidate.kind = patch.kind;
  if (patch.status !== undefined) candidate.status = patch.status;
  if (patch.members !== undefined) candidate.members = patch.members;
  if (patch.prerequisites !== undefined) candidate.prerequisites = patch.prerequisites;
  if (patch.note === null) {
    candidate = omitGoalNote(candidate);
  } else if (patch.note !== undefined) {
    candidate.note = patch.note;
  }

  const next = GoalSchema.parse(candidate);
  // 一次更新可能通过四条通道释放成员：status→archived、kind→theme、members 整包替换、以及组合。
  // 用前后归属差集统一覆盖，将来新增的调用方自动被覆盖。
  const released = releasedProjectTaskIds(existing, next);
  await db.transaction("rw", db.goals, db.tasks, db.syncLog, async () => {
    await db.goals.put(next);
    await recordSyncLog("goals", next.id, "update", next.updatedAt);
    await touchTasksInCurrentTransaction(released, next.updatedAt);
  });
  return next;
}

export async function updateGoalPrerequisites(
  id: string,
  prerequisites: GoalPrerequisite[],
  options: { now?: Date } = {},
): Promise<Goal> {
  return updateGoal(id, { prerequisites, now: options.now });
}

export async function getGoal(id: string): Promise<Goal | undefined> {
  const row = await db.goals.get(id);
  if (!row) return undefined;
  const parsed = GoalSchema.safeParse(row);
  if (!parsed.success) return undefined;
  return parsed.data;
}

export async function listGoals(status?: Goal["status"]): Promise<Goal[]> {
  const rows = status ? await db.goals.where("status").equals(status).toArray() : await db.goals.toArray();
  const goals: Goal[] = [];
  for (const row of rows) {
    const parsed = GoalSchema.safeParse(row);
    if (!parsed.success) {
      warnInvalidGoal(row, parsed.error.issues);
      continue;
    }
    goals.push(parsed.data);
  }
  return goals.sort(byGoalOrder);
}

export async function addGoalMember(
  goalId: string,
  ref: GoalMemberRef,
  options: { now?: Date } = {},
): Promise<Goal> {
  const timestamp = nowIso(options.now);
  let nextGoal: Goal | null = null;

  await db.transaction("rw", db.goals, db.tasks, db.tracks, db.syncLog, async () => {
    const goal = await db.goals.get(goalId);
    if (!goal) throw new Error("目标不存在");
    if (ref.kind === "task" && !(await db.tasks.get(ref.id))) throw new Error("任务不存在");
    if (ref.kind === "track" && !(await db.tracks.get(ref.id))) throw new Error("轨道不存在");

    const members = goal.members ?? [];
    if (members.some((member) => sameGoalMember(member, ref))) {
      nextGoal = GoalSchema.parse({ ...goal, members, prerequisites: goal.prerequisites ?? [] });
      return;
    }

    const next = GoalSchema.parse({
      ...goal,
      members: [...members, ref],
      prerequisites: goal.prerequisites ?? [],
      updatedAt: timestamp,
    });
    await db.goals.put(next);
    await recordSyncLog("goals", next.id, "update", timestamp);
    if (ref.kind === "task" && ownedProjectTaskIds(next).includes(ref.id)) {
      await touchTasksInCurrentTransaction([ref.id], timestamp);
    }
    nextGoal = next;
  });

  if (!nextGoal) throw new Error("目标不存在");
  return nextGoal;
}

export async function removeGoalMember(
  goalId: string,
  ref: GoalMemberRef,
  options: { now?: Date } = {},
): Promise<Goal> {
  const timestamp = nowIso(options.now);
  let nextGoal: Goal | null = null;

  await db.transaction("rw", db.goals, db.goalLayoutPins, db.tasks, db.syncLog, async () => {
    const goal = await db.goals.get(goalId);
    if (!goal) throw new Error("目标不存在");

    const members = goal.members ?? [];
    if (!members.some((member) => sameGoalMember(member, ref))) {
      nextGoal = GoalSchema.parse({ ...goal, members, prerequisites: goal.prerequisites ?? [] });
      return;
    }

    const nextMembers = members.filter((member) => !sameGoalMember(member, ref));
    const nextPrerequisites = (goal.prerequisites ?? []).filter(
      (edge) => !sameGoalMember(edge.blocker, ref) && !sameGoalMember(edge.blocked, ref),
    );
    const next = GoalSchema.parse({
      ...goal,
      members: nextMembers,
      prerequisites: nextPrerequisites,
      updatedAt: timestamp,
    });
    await db.goals.put(next);
    await recordSyncLog("goals", next.id, "update", timestamp);
    // 移出成员：同事务回收它在本 Goal 下的布局钉点，不留孤儿。
    await deleteGoalMemberPinInCurrentTransaction({ goalId, nodeKind: ref.kind, nodeId: ref.id }, options.now);
    await touchTasksInCurrentTransaction(releasedProjectTaskIds(goal, next), timestamp);
    nextGoal = next;
  });

  if (!nextGoal) throw new Error("目标不存在");
  return nextGoal;
}

/** 归入项目被拒。`block` 给调用方分支用，`message` 已是可直接展示的中文。 */
export class ProjectAssignError extends Error {
  readonly block: ProjectAssignBlock;
  readonly goalTitle: string;

  // 显式字段赋值而非 TS 参数属性：参数属性是不可擦除语法，将来上 `erasableSyntaxOnly`
  // 或换纯类型剥离的转译链会当场炸，这里没必要冒这个险。
  constructor(block: ProjectAssignBlock, goalTitle: string) {
    super(projectAssignBlockMessage(block, goalTitle));
    this.name = "ProjectAssignError";
    this.block = block;
    this.goalTitle = goalTitle;
  }
}

/**
 * 把一条任务归入某个 active project。
 *
 * **单一归属是写入侧不变量**（design §多重归属）：同事务内先把它从其它 active project 摘掉再加入，
 * 读侧的 `projectMemberIndex` 仲裁只作为存量与跨设备并发的兜底，不承担正确性。
 *
 * 摘/加都复用 `removeGoalMember` / `addGoalMember`：它们已经负担幂等、`prerequisites` 边清理、
 * `goalLayoutPins` 回收、成员任务 touch + syncLog 四件事，重写一遍必漂。Dexie 的嵌套事务会并入
 * 外层这个 rw 事务（表是子集），因此任一步抛错整包回滚，不会留下「A 摘了但 B 没加上」的半截状态。
 *
 * 读 goals 走 `toArray()` 裸行、不过 `GoalSchema.parse`：superRefine 会因单个成员重复 reject 整行，
 * 让整组归属静默失效（同 `listTasks` / `findActiveProjectGoalIdForTask`）。
 */
export async function assignTaskToProject(
  goalId: string,
  taskId: string,
  options: { now?: Date } = {},
): Promise<Goal> {
  let nextGoal: Goal | null = null;

  await db.transaction("rw", db.goals, db.goalLayoutPins, db.tasks, db.tracks, db.syncLog, async () => {
    const task = await db.tasks.get(taskId);
    if (!task) throw new Error("任务不存在");

    const goalRows = await db.goals.toArray();
    const target = goalRows.find((row) => row.id === goalId);
    if (!target) throw new Error("目标不存在");

    const members = target.members ?? [];
    const already = members.some((member) => member.kind === "task" && member.id === taskId);
    // 已在组内时不看 full：幂等重入不会让数组变长，此时报「满员」是假拒绝。
    const block = projectAssignBlock(task, members.length);
    if (block !== null && !(block === "full" && already)) throw new ProjectAssignError(block, target.title);

    for (const row of goalRows) {
      if (row.id === goalId) continue;
      // 只摘 active project：theme 归属走绿竖条那条独立通道，归档目标读侧本来就不认。
      if (row.status !== "active" || row.kind !== "project") continue;
      if (!(row.members ?? []).some((member) => member.kind === "task" && member.id === taskId)) continue;
      await removeGoalMember(row.id, { kind: "task", id: taskId }, options);
    }

    nextGoal = await addGoalMember(goalId, { kind: "task", id: taskId }, options);
  });

  if (!nextGoal) throw new Error("目标不存在");
  return nextGoal;
}

export async function addTaskForGoal(goalId: string, input: AddTaskForGoalInput): Promise<Task> {
  const task = await buildNewRootTask({ title: input.title, toInbox: input.toInbox, now: input.now });
  let nextTask: Task | null = null;

  await db.transaction("rw", db.goals, db.tasks, db.syncLog, async () => {
    const goal = await db.goals.get(goalId);
    if (!goal) throw new Error("目标不存在");
    if (goal.status !== "active") throw new Error("归档目标不允许快建任务");

    const nextGoal = GoalSchema.parse({
      ...goal,
      members: [...(goal.members ?? []), { kind: "task", id: task.id }],
      prerequisites: goal.prerequisites ?? [],
      updatedAt: task.updatedAt,
    });

    await insertNewTaskInCurrentTransaction(task);
    await db.goals.put(nextGoal);
    await recordSyncLog("goals", nextGoal.id, "update", nextGoal.updatedAt);
    nextTask = task;
  });

  if (!nextTask) throw new Error("目标不存在");
  return nextTask;
}

export async function listGoalTasks(goalId: string): Promise<Task[]> {
  const goal = await getGoal(goalId);
  if (!goal) return [];
  const taskIds = goal.members.filter((member) => member.kind === "task").map((member) => member.id);
  const rows = await db.tasks.bulkGet(taskIds);
  const byId = new Map<string, Task>();
  for (const row of rows) {
    const parsed = TaskSchema.safeParse(row);
    if (parsed.success) byId.set(parsed.data.id, parsed.data);
  }
  return taskIds.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
}

export async function listGoalTracks(goalId: string): Promise<Track[]> {
  const goal = await getGoal(goalId);
  if (!goal) return [];
  const trackIds = goal.members.filter((member) => member.kind === "track").map((member) => member.id);
  const rows = await db.tracks.bulkGet(trackIds);
  const byId = new Map<string, Track>();
  for (const row of rows) {
    const parsed = TrackSchema.safeParse(row);
    if (parsed.success) byId.set(parsed.data.id, parsed.data);
  }
  return trackIds.flatMap((id) => {
    const track = byId.get(id);
    return track ? [track] : [];
  });
}

export async function deleteGoal(id: string, options: { now?: Date } = {}): Promise<void> {
  const timestamp = nowIso(options.now);
  await db.transaction("rw", db.goals, db.goalLayoutPins, db.tasks, db.syncLog, async () => {
    const goal = await db.goals.get(id);
    if (!goal) throw new Error("目标不存在");

    // 删除 Goal：同事务回收它的 world pin 与全部成员 pin，避免孤儿钉点残留在同步域。
    await deleteGoalLayoutPinsForGoalInCurrentTransaction(id, options.now);
    await db.goals.delete(id);
    await recordSyncLog("goals", id, "delete", timestamp);
    // 删除与归档同样让成员失去归属，必须一起浮上水面。
    await touchTasksInCurrentTransaction(ownedProjectTaskIds(goal), timestamp);
  });
}

/**
 * 找 taskId 当前所属的 active project 目标 id，没有则 null。
 *
 * 与 `buckets.projects` 的口径差别是**刻意的**：那份投影只收根任务、只索引未完成成员，
 * 而本函数认 `members` 的原始事实——待办页的落点反馈要在「子任务刚升成根」
 * 「已完成成员刚被取消勾选」这两个瞬间查得到归属，那时任务还不在投影里。
 *
 * 读裸行、不过 `GoalSchema.parse`：`superRefine` 会因单个成员重复 reject 整行，
 * 让整组归属静默失效（`listTasks` 同款理由）。仲裁（同挂多个 active project 取
 * `updatedAt` 新者、并列取 `id` 字典序小者）直接复用 `projectMemberIndex`，
 * 与项目区分组共用同一份代码，不会漂移。
 */
export async function findActiveProjectGoalIdForTask(taskId: string): Promise<string | null> {
  const goalRows = await db.goals.toArray();
  return projectMemberIndex(goalRows).get(taskId)?.goalId ?? null;
}
