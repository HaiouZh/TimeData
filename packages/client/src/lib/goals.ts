import { GoalSchema, TaskSchema, TrackSchema, type Goal, type GoalMemberRef, type GoalPrerequisite, type Task, type Track } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import {
  deleteGoalLayoutPinsForGoalInCurrentTransaction,
  deleteGoalMemberPinInCurrentTransaction,
} from "./goalLayoutPins.js";
import { recordSyncLog } from "../sync/engine.js";
import {
  exceedsGoalMemberCap,
  ownedProjectTaskIds,
  projectAssignBlock,
  projectAssignBlockMessage,
  projectMemberIndex,
  releasedProjectTaskIds,
  taskAssignBlock,
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

export function sameGoalMember(left: GoalMemberRef, right: GoalMemberRef): boolean {
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

/**
 * 移除成员的事务内原语。**必须在已开启的 rw 事务内调用**，事务表须含
 * goals / goalLayoutPins / tasks / syncLog。抽出来是为了让「拖拽收纳时清项目归属」
 * 与「手动移出项目」共用同一份连带逻辑（钉点回收、prerequisites 边、touch），
 * 两条路径行为不会漂。
 */
export async function removeGoalMemberInCurrentTransaction(
  goal: Goal,
  ref: GoalMemberRef,
  timestamp: string,
  now?: Date,
): Promise<Goal> {
  const members = goal.members ?? [];
  if (!members.some((member) => sameGoalMember(member, ref))) {
    return GoalSchema.parse({ ...goal, members, prerequisites: goal.prerequisites ?? [] });
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
  await deleteGoalMemberPinInCurrentTransaction({ goalId: goal.id, nodeKind: ref.kind, nodeId: ref.id }, now);
  await touchTasksInCurrentTransaction(releasedProjectTaskIds(goal, next), timestamp);
  return next;
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
    nextGoal = await removeGoalMemberInCurrentTransaction(goal as Goal, ref, timestamp, options.now);
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
    // 目标组必须**仍然**是 active project。缺了这道闸，另一端归档 / 改成 theme 后（本页项目区还没刷新完，
    // droppable 仍在）拖进来会照常摘除、照常写入，而读侧只认 active project——这条任务从此不属于任何组，
    // 是静默的归属丢失。同文件 `addTaskForGoal` 早有同款闸，此处缺失属不对称。
    if (target.status !== "active" || target.kind !== "project") {
      throw new ProjectAssignError("inactive", target.title);
    }

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

/**
 * 把 `taskId` 归入 `nextGoalId` 时，会被连带删掉的前置依赖边数量与来源组名。
 *
 * 摘除成员必然删掉源组里引用它的边（`GoalSchema` superRefine 要求 prerequisite 必须指向成员，
 * 不删则整行 parse 失败、整个目标从 UI 与同步里消失），所以这不是可选副作用而是硬后果。
 * 待办页在拖拽落库前用它决定要不要先问一句——同样的破坏在 goals 页是显式动作，在这里只是一次手滑。
 *
 * 读裸行不过 `GoalSchema.parse`：superRefine 会因单个成员重复 reject 整行，
 * 那会让这次询问静默失效、用户在毫不知情下丢掉整组边（同 `assignTaskToProject`）。
 *
 * 单一归属是写入侧不变量，正常情况下最多命中一个源组；但存量与跨设备并发能造出多个，
 * 故 `count` 是全部命中组之和、`groupCount` 是命中的组数，`goalTitle` 取边最多的那一组
 *（一句话里只塞得下一个名字）。
 *
 * **`goalTitle` 只有在 `groupCount === 1` 时才能和 `count` 摆进同一句话**：多组时那个名字底下的边数
 * 严格少于 `count`，说成「在「X」里有 N 条」用户去 X 里数不出 N，一次数不对就再也不信这个提示了。
 * 调用方按 `groupCount` 分两句说，别把两个字段硬凑一句。
 */
export async function prerequisiteLossOnAssign(
  taskId: string,
  nextGoalId: string,
): Promise<{ count: number; groupCount: number; goalTitle: string } | null> {
  const ref: GoalMemberRef = { kind: "task", id: taskId };
  const rows = await db.goals.toArray();
  let total = 0;
  let groupCount = 0;
  let widest: { count: number; title: string } | null = null;

  for (const row of rows) {
    if (row.id === nextGoalId) continue;
    // 只数会被真的摘除的组：摘除循环本身也只认 active project（theme 归属与归档组都不摘）。
    if (row.status !== "active" || row.kind !== "project") continue;
    if (!(row.members ?? []).some((member) => sameGoalMember(member, ref))) continue;
    // 判据与 removeGoalMember 里那句 filter 一字对应，两处漂了就会问一个不发生的后果。
    const count = (row.prerequisites ?? []).filter(
      (edge) => sameGoalMember(edge.blocker, ref) || sameGoalMember(edge.blocked, ref),
    ).length;
    if (count === 0) continue;
    total += count;
    groupCount += 1;
    if (!widest || count > widest.count) widest = { count, title: row.title };
  }

  return widest === null ? null : { count: total, groupCount, goalTitle: widest.title };
}

/**
 * 把多条任务一次性归入某个 active project。**单事务，全成功或全失败。**
 *
 * 与 `assignTaskToProject` 只有两处不同，其余（摘旧组、准入闸、touch、裸行读）完全同源：
 * ① 目标组的 active + project 闸只判一次；
 * ② 500 上限判在**整批之上**（`members.length + 新增数 > 500`），不是逐条问「已经满了吗」——
 *    逐条判要到第 501 条才抛，而前 500 条已经写进去了，与「全成功或全失败」直接矛盾。
 *
 * 不做「能进多少进多少」：部分成功会留下「选了 6 条为何只进去 4 条」的哑谜，
 * 而撞 500 在真实使用里近乎不发生（design §动作一）。
 */
export async function assignTasksToProject(
  goalId: string,
  taskIds: readonly string[],
  options: { now?: Date } = {},
): Promise<Goal> {
  if (taskIds.length === 0) throw new Error("没有选中任务");
  // **入口去重，容量不变量不能外包给调用方。** `existing` 是循环外拿的成员快照、不随本次写入更新，
  // 同一个 id 传两次会让 `addCount` 多记一格，恰好卡在 500 边界时误报满员。`addGoalMember` 的幂等
  // 只保证不重复写进 members，救不了容量判定这一侧——那是两回事。
  //
  // 之所以不能靠「调用方传的是 Set」：500 是 `GoalSchema.members` 的 `.max(500)` 硬闸，撞上不是报个错，
  // 而是整行 parse 失败、整个 goal 从 UI 与同步里一起消失。没有任何东西保护那个假设，就在入口自己钉死。
  const uniqueTaskIds = [...new Set(taskIds)];
  let nextGoal: Goal | null = null;

  await db.transaction("rw", db.goals, db.goalLayoutPins, db.tasks, db.tracks, db.syncLog, async () => {
    const goalRows = await db.goals.toArray();
    const target = goalRows.find((row) => row.id === goalId);
    if (!target) throw new Error("目标不存在");
    // 目标组必须**仍然**是 active project。缺了这道闸，另一端归档 / 改成 theme 后拖进来会照常摘除、
    // 照常写入，而读侧只认 active project——这批任务从此不属于任何组，是静默的归属丢失。
    if (target.status !== "active" || target.kind !== "project") {
      throw new ProjectAssignError("inactive", target.title);
    }

    const members = target.members ?? [];
    const existing = new Set(members.filter((member) => member.kind === "task").map((member) => member.id));

    // 先把整批验完再动手：任一条不合格就整批拒绝，不留「写了一半」的中间态。
    let addCount = 0;
    for (const taskId of uniqueTaskIds) {
      const task = await db.tasks.get(taskId);
      if (!task) throw new Error("任务不存在");
      const block = taskAssignBlock(task);
      if (block !== null) throw new ProjectAssignError(block, target.title);
      // 已在组内的不计入新增：幂等重入不会让数组变长，把它算进去会造出假的满员。
      if (!existing.has(taskId)) addCount += 1;
    }
    if (exceedsGoalMemberCap(members.length, addCount)) {
      throw new ProjectAssignError("full", target.title);
    }

    for (const taskId of uniqueTaskIds) {
      for (const row of goalRows) {
        if (row.id === goalId) continue;
        // 只摘 active project：theme 归属走绿竖条那条独立通道，归档目标读侧本来就不认。
        if (row.status !== "active" || row.kind !== "project") continue;
        if (!(row.members ?? []).some((member) => member.kind === "task" && member.id === taskId)) continue;
        // goalRows 是事务入口的快照，摘除会让它过期——但只用于「要不要调一次」，
        // removeGoalMember 自己重读最新行，快照过期最多多调一次无害的 no-op。
        await removeGoalMember(row.id, { kind: "task", id: taskId }, options);
      }
      nextGoal = await addGoalMember(goalId, { kind: "task", id: taskId }, options);
    }
  });

  if (!nextGoal) throw new Error("目标不存在");
  return nextGoal;
}

/**
 * 建新项目并一次性收编成员。**单事务**：不留空 Goal，也不留成员写了一半的中间态。
 *
 * 成员走 `assignTasksToProject` 而不是直接塞 `members` 数组——摘旧组、准入闸、500 上限、成员 touch
 * 只有一份实现，将来改归属语义不会漏掉建组这一侧。嵌套 `db.transaction` 的表列表是本事务的子集，
 * Dexie 会并入父事务，原子性不破。
 */
export async function createProjectWithMembers(input: {
  title: string;
  taskIds: readonly string[];
  now?: Date;
}): Promise<Goal> {
  const title = trimRequired(input.title, "项目名不能为空");
  if (input.taskIds.length === 0) throw new Error("没有选中任务");
  const createdAt = nowIso(input.now);
  const goalId = uuid();
  let nextGoal: Goal | null = null;

  await db.transaction("rw", db.goals, db.goalLayoutPins, db.tasks, db.tracks, db.syncLog, async () => {
    const seed = GoalSchema.parse({
      id: goalId,
      title,
      kind: "project",
      status: "active",
      members: [],
      prerequisites: [],
      createdAt,
      updatedAt: createdAt,
    });
    await db.goals.add(seed);
    await recordSyncLog("goals", seed.id, "create", seed.updatedAt);
    nextGoal = await assignTasksToProject(goalId, input.taskIds, input.now ? { now: input.now } : {});
  });

  if (!nextGoal) throw new Error("建项目失败");
  return nextGoal;
}

/**
 * 把 `taskIds` 整批归入 `nextGoalId`（**建新组传 `null`**）时会被连带删掉的前置依赖边。
 *
 * 语义与单条版 `prerequisiteLossOnAssign` 一致（那条的长注释说明了为什么 `goalTitle` 只在
 * `groupCount === 1` 时才能和 `count` 摆进同一句话），只多一条批量特有的规矩：
 * **一条边同时挂两个被摘成员时只数一次**——逐条相加会说多，用户去核对发现对不上，
 * 一次数不对就再也不信这个提示。
 */
export async function prerequisiteLossOnAssignMany(
  taskIds: readonly string[],
  nextGoalId: string | null,
): Promise<{ count: number; groupCount: number; goalTitle: string } | null> {
  const refs: GoalMemberRef[] = taskIds.map((id) => ({ kind: "task", id }));
  const rows = await db.goals.toArray();
  let total = 0;
  let groupCount = 0;
  let widest: { count: number; title: string } | null = null;

  for (const row of rows) {
    if (row.id === nextGoalId) continue;
    // 只数会被真的摘除的组：摘除循环本身也只认 active project（theme 归属与归档组都不摘）。
    if (row.status !== "active" || row.kind !== "project") continue;
    const hit = refs.filter((ref) => (row.members ?? []).some((member) => sameGoalMember(member, ref)));
    if (hit.length === 0) continue;
    // filter 而非逐条累加：一条边挂两个被摘成员时只落进结果一次。
    const edges = (row.prerequisites ?? []).filter((edge) =>
      hit.some((ref) => sameGoalMember(edge.blocker, ref) || sameGoalMember(edge.blocked, ref)),
    );
    if (edges.length === 0) continue;
    total += edges.length;
    groupCount += 1;
    if (!widest || edges.length > widest.count) widest = { count: edges.length, title: row.title };
  }

  return widest === null ? null : { count: total, groupCount, goalTitle: widest.title };
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

export async function createTaskForProject(
  goalId: string,
  input: { title: string; now?: Date },
): Promise<Task> {
  const task = await buildNewRootTask({ title: input.title, toInbox: true, now: input.now });
  let created: Task | null = null;

  await db.transaction("rw", db.goals, db.goalLayoutPins, db.tasks, db.tracks, db.syncLog, async () => {
    await insertNewTaskInCurrentTransaction(task);
    await assignTaskToProject(goalId, task.id, input.now ? { now: input.now } : {});
    created = (await db.tasks.get(task.id)) ?? task;
  });

  if (!created) throw new Error("项目内创建任务失败");
  return created;
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
