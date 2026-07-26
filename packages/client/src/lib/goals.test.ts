import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import {
  addGoal,
  addGoalMember,
  addTaskForGoal,
  assignTaskToProject,
  deleteGoal,
  findActiveProjectGoalIdForTask,
  getGoal,
  listGoals,
  prerequisiteLossOnAssign,
  ProjectAssignError,
  removeGoalMember,
  updateGoal,
  updateGoalPrerequisites,
} from "./goals.js";
import { addTask } from "./tasks.js";

const now = "2026-06-22T01:00:00.000Z";

beforeEach(resetDb);

afterEach(resetDb);

function date(iso: string): Date {
  return new Date(iso);
}

async function seedMembers(): Promise<void> {
  await db.tasks.add({
    id: "task-1",
    parentId: null,
    title: "写发布文案",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.tracks.add({
    id: "track-1",
    title: "发布轨道",
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
  });
}

describe("goals data helpers", () => {
  it("creates, lists, reads, and updates goals with sync logs", async () => {
    const goal = await addGoal({ title: " 发布 v2 ", kind: "project", now: date(now) });

    expect(goal).toMatchObject({ title: "发布 v2", kind: "project", status: "active", members: [], prerequisites: [] });
    await expect(getGoal(goal.id)).resolves.toMatchObject({ title: "发布 v2" });
    await expect(listGoals()).resolves.toHaveLength(1);

    const updated = await updateGoal(goal.id, {
      title: "发布 v2.1",
      kind: "theme",
      note: "长期推进",
      now: date("2026-06-22T02:00:00.000Z"),
    });
    expect(updated).toMatchObject({ title: "发布 v2.1", kind: "theme", note: "长期推进" });
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "goals", action: "create" }),
        expect.objectContaining({ tableName: "goals", action: "update" }),
      ]),
    );
  });

  it("adds and removes typed members without mutating tasks or tracks", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();

    await addGoalMember(goal.id, { kind: "task", id: "task-1" }, { now: date("2026-06-22T02:00:00.000Z") });
    await addGoalMember(goal.id, { kind: "track", id: "track-1" }, { now: date("2026-06-22T02:01:00.000Z") });

    await expect(db.goals.get(goal.id)).resolves.toMatchObject({
      members: [
        { kind: "task", id: "task-1" },
        { kind: "track", id: "track-1" },
      ],
    });
    await expect(db.tasks.get("task-1")).resolves.not.toHaveProperty("goalId");
    await expect(db.tracks.get("track-1")).resolves.not.toHaveProperty("goalId");

    await addGoalMember(goal.id, { kind: "task", id: "task-1" }, { now: date("2026-06-22T02:02:00.000Z") });
    await expect(db.goals.get(goal.id)).resolves.toMatchObject({
      members: [
        { kind: "task", id: "task-1" },
        { kind: "track", id: "track-1" },
      ],
    });

    await removeGoalMember(goal.id, { kind: "task", id: "task-1" }, { now: date("2026-06-22T03:00:00.000Z") });
    await expect(db.goals.get(goal.id)).resolves.toMatchObject({ members: [{ kind: "track", id: "track-1" }] });
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "goals", recordId: goal.id, action: "update" })]),
    );
  });

  it("updates prerequisites and rejects invalid goal edits through shared schema", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();
    await addGoalMember(goal.id, { kind: "task", id: "task-1" });
    await addGoalMember(goal.id, { kind: "track", id: "track-1" });
    await updateGoalPrerequisites(
      goal.id,
      [{ blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } }],
      { now: date("2026-06-22T02:00:00.000Z") },
    );
    await expect(getGoal(goal.id)).resolves.toMatchObject({
      prerequisites: [{ blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } }],
    });
    await expect(
      updateGoalPrerequisites(goal.id, [
        { blocker: { kind: "task", id: "task-1" }, blocked: { kind: "task", id: "task-1" } },
      ]),
    ).rejects.toThrow();
  });

  it("removing a member also removes related prerequisites", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();
    await addGoalMember(goal.id, { kind: "task", id: "task-1" });
    await addGoalMember(goal.id, { kind: "track", id: "track-1" });
    await updateGoalPrerequisites(goal.id, [
      { blocker: { kind: "task", id: "task-1" }, blocked: { kind: "track", id: "track-1" } },
    ]);

    await removeGoalMember(goal.id, { kind: "task", id: "task-1" });

    await expect(db.goals.get(goal.id)).resolves.toMatchObject({
      members: [{ kind: "track", id: "track-1" }],
      prerequisites: [],
    });
  });

  it("deletes a goal and keeps members untouched", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    await seedMembers();
    await addGoalMember(goal.id, { kind: "task", id: "task-1" }, { now: date("2026-06-22T02:00:00.000Z") });

    await deleteGoal(goal.id, { now: date("2026-06-22T03:00:00.000Z") });

    await expect(db.goals.get(goal.id)).resolves.toBeUndefined();
    await expect(db.tasks.get("task-1")).resolves.toBeDefined();
    await expect(db.tracks.get("track-1")).resolves.toBeDefined();
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "goals", recordId: goal.id, action: "delete" })]),
    );
  });

  it("creates a task and appends it to Goal.members atomically", async () => {
    const goal = await addGoal({ title: "发布 v2", kind: "project", now: date(now) });
    const task = await addTaskForGoal(goal.id, {
      title: "写发布文案",
      toInbox: false,
      now: date("2026-06-22T02:00:00.000Z"),
    });

    expect(task).toMatchObject({ title: "写发布文案", done: false, tags: [] });
    await expect(db.goals.get(goal.id)).resolves.toMatchObject({
      members: [{ kind: "task", id: task.id }],
    });
    await expect(db.syncLog.toArray()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "tasks", recordId: task.id, action: "create" }),
        expect.objectContaining({ tableName: "goals", recordId: goal.id, action: "update" }),
      ]),
    );
  });
});

describe("归属变更同事务刷新成员任务 updatedAt", () => {
  const STALE = "2026-01-01T00:00:00.000Z";

  async function staleTaskInProject(): Promise<{ goalId: string; taskId: string }> {
    const goal = await addGoal({ title: "装修", kind: "project" });
    const task = await addTask({ title: "刷墙", toInbox: true });
    await addGoalMember(goal.id, { kind: "task", id: task.id });
    await db.tasks.update(task.id, { updatedAt: STALE });
    return { goalId: goal.id, taskId: task.id };
  }

  it("removeGoalMember 刷新被移出任务的 updatedAt 并记 syncLog", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await removeGoalMember(goalId, { kind: "task", id: taskId });

    const after = await db.tasks.get(taskId);
    expect(after?.updatedAt).not.toBe(STALE);
    // 不筛 action 会被 staleTaskInProject() 里 addTask 写的 create 日志误判成真；
    // 只有 action === "update" 且 timestamp 对得上刷新后的 updatedAt，才是 touch 本身写的那条。
    const logs = await db.syncLog.filter((e) => e.tableName === "tasks" && e.recordId === taskId).toArray();
    const touchLog = logs.find((log) => log.action === "update" && log.timestamp === after?.updatedAt);
    expect(touchLog).toBeDefined();
  });

  it("addGoalMember 加入 active project 刷新被加入任务的 updatedAt 并记 syncLog", async () => {
    // 增益方向与失去方向同等重要：任务刚被圈进项目时若不刷新 updatedAt，
    // 它会带着旧时间戳参与重力水位线判定，直接沉进默认折叠的水下区——
    // 用户刚做完"归入"这个动作，转头发现任务不见了。
    const goal = await addGoal({ title: "装修", kind: "project" });
    const task = await addTask({ title: "刷墙", toInbox: true });
    await db.tasks.update(task.id, { updatedAt: STALE });

    await addGoalMember(goal.id, { kind: "task", id: task.id });

    const after = await db.tasks.get(task.id);
    expect(after?.updatedAt).not.toBe(STALE);
    // 不筛 action 会被 addTask 写的 create 日志误判成真；
    // 只有 action === "update" 且 timestamp 对得上刷新后的 updatedAt，才是 touch 本身写的那条。
    const logs = await db.syncLog.filter((e) => e.tableName === "tasks" && e.recordId === task.id).toArray();
    const touchLog = logs.find((log) => log.action === "update" && log.timestamp === after?.updatedAt);
    expect(touchLog).toBeDefined();
  });

  it("归档目标刷新全部成员任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await updateGoal(goalId, { status: "archived" });
    expect((await db.tasks.get(taskId))?.updatedAt).not.toBe(STALE);
  });

  it("kind 从 project 改成 theme 也刷新成员任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await updateGoal(goalId, { kind: "theme" });
    expect((await db.tasks.get(taskId))?.updatedAt).not.toBe(STALE);
  });

  it("members 整包替换移除成员时刷新（GoalGraphEditor 的撤销路径）", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await updateGoal(goalId, { members: [] });
    expect((await db.tasks.get(taskId))?.updatedAt).not.toBe(STALE);
  });

  it("deleteGoal 刷新全部成员任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await deleteGoal(goalId);
    expect((await db.tasks.get(taskId))?.updatedAt).not.toBe(STALE);
  });

  it("只改标题不刷新成员任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await updateGoal(goalId, { title: "新名字" });
    expect((await db.tasks.get(taskId))?.updatedAt).toBe(STALE);
  });

  it("重复加同一成员（幂等早退）不刷新任务", async () => {
    const { goalId, taskId } = await staleTaskInProject();
    await db.tasks.update(taskId, { updatedAt: STALE });
    await addGoalMember(goalId, { kind: "task", id: taskId });
    expect((await db.tasks.get(taskId))?.updatedAt).toBe(STALE);
  });

  it("移出本就不在组里的成员（幂等早退）不刷新任务", async () => {
    const goal = await addGoal({ title: "装修", kind: "project" });
    const task = await addTask({ title: "无关任务", toInbox: true });
    await db.tasks.update(task.id, { updatedAt: STALE });
    await removeGoalMember(goal.id, { kind: "task", id: task.id });
    expect((await db.tasks.get(task.id))?.updatedAt).toBe(STALE);
  });

  it("theme 目标的成员变更不触发 touch（只有 active project 拥有归属）", async () => {
    const goal = await addGoal({ title: "主题", kind: "theme" });
    const task = await addTask({ title: "主题任务", toInbox: true });
    await addGoalMember(goal.id, { kind: "task", id: task.id });
    await db.tasks.update(task.id, { updatedAt: STALE });
    await removeGoalMember(goal.id, { kind: "task", id: task.id });
    expect((await db.tasks.get(task.id))?.updatedAt).toBe(STALE);
  });

  // 下面两条盯的是 addGoalMember 里 `ref.kind === "task" && ownedProjectTaskIds(next).includes(ref.id)` 的
  // **右半边**：只测「两个条件都真」的话，把 && 写成 || 也照样绿。盖 STALE 必须在 add **之前**——
  // 上面那条 theme 用例是先 add 再盖 STALE，add 阶段真发生了错误 touch 也被后盖的 STALE 抹掉了。
  it("加进 theme 目标不 touch（先盖 STALE 再 add，才验得到 add 这一步）", async () => {
    const goal = await addGoal({ title: "主题", kind: "theme" });
    const task = await addTask({ title: "主题任务", toInbox: true });
    await db.tasks.update(task.id, { updatedAt: STALE });

    await addGoalMember(goal.id, { kind: "task", id: task.id });

    // 错误 touch 的实际伤害：任务被无故顶上重力水位线，从水下折叠区冒出来。
    expect((await db.tasks.get(task.id))?.updatedAt).toBe(STALE);
  });

  it("加进已归档 project 不 touch（归档目标不拥有归属）", async () => {
    const goal = await addGoal({ title: "旧项目", kind: "project" });
    await updateGoal(goal.id, { status: "archived" });
    const task = await addTask({ title: "旧任务", toInbox: true });
    await db.tasks.update(task.id, { updatedAt: STALE });

    await addGoalMember(goal.id, { kind: "task", id: task.id });

    expect((await db.tasks.get(task.id))?.updatedAt).toBe(STALE);
  });

  it("members 裸行含重复 task ref 时 touch 只记一条 syncLog（不受 GoalSchema 唯一性约束保护）", async () => {
    const goal = await addGoal({ title: "装修", kind: "project" });
    const task = await addTask({ title: "刷墙", toInbox: true });
    const raw = await db.goals.get(goal.id);
    if (!raw) throw new Error("goal 不存在");
    // 直接 put 裸行绕开 GoalSchema.parse 的 members 唯一性 superRefine——
    // 生产路径上 ownedProjectTaskIds 读到的正是这种未经校验的裸行。
    await db.goals.put({
      ...raw,
      members: [
        { kind: "task", id: task.id },
        { kind: "task", id: task.id },
      ],
    });

    await deleteGoal(goal.id);

    const updateLogs = await db.syncLog
      .filter((e) => e.tableName === "tasks" && e.recordId === task.id && e.action === "update")
      .toArray();
    expect(updateLogs).toHaveLength(1);
  });
});

describe("findActiveProjectGoalIdForTask", () => {
  it("认 members 原始事实：子任务成员与已完成成员都查得到（项目区投影会把它们丢掉）", async () => {
    // 投影层只收根任务、只索引未完成成员，所以这两类在 buckets.projects 里根本不存在。
    // 而落点反馈恰恰要在「刚从子任务升成根」「刚从已完成回到未完成」这两个瞬间查得到归属。
    const goal = await addGoal({ title: "装修", kind: "project" });
    const parent = await addTask({ title: "父任务", toInbox: true });
    const child = await addTask({ title: "子任务", toInbox: true });
    const done = await addTask({ title: "已完成的", toInbox: true });
    await addGoalMember(goal.id, { kind: "task", id: child.id });
    await addGoalMember(goal.id, { kind: "task", id: done.id });
    await db.tasks.update(child.id, { parentId: parent.id });
    await db.tasks.update(done.id, { done: true, completedAt: now });

    expect(await findActiveProjectGoalIdForTask(child.id)).toBe(goal.id);
    expect(await findActiveProjectGoalIdForTask(done.id)).toBe(goal.id);
  });

  it("只认 active project：theme 与 archived 都不算归属", async () => {
    const theme = await addGoal({ title: "主题", kind: "theme" });
    const archived = await addGoal({ title: "旧项目", kind: "project" });
    const themeTask = await addTask({ title: "主题任务", toInbox: true });
    const archivedTask = await addTask({ title: "旧任务", toInbox: true });
    await addGoalMember(theme.id, { kind: "task", id: themeTask.id });
    await addGoalMember(archived.id, { kind: "task", id: archivedTask.id });
    await updateGoal(archived.id, { status: "archived" });

    expect(await findActiveProjectGoalIdForTask(themeTask.id)).toBeNull();
    expect(await findActiveProjectGoalIdForTask(archivedTask.id)).toBeNull();
  });

  it("同挂多个 active project 时与项目区分组同一套仲裁：updatedAt 新者胜", async () => {
    const older = await addGoal({ title: "旧组", kind: "project" });
    const newer = await addGoal({ title: "新组", kind: "project" });
    const task = await addTask({ title: "双挂任务", toInbox: true });
    await addGoalMember(older.id, { kind: "task", id: task.id }, { now: date("2026-06-22T02:00:00.000Z") });
    await addGoalMember(newer.id, { kind: "task", id: task.id }, { now: date("2026-06-22T03:00:00.000Z") });

    expect(await findActiveProjectGoalIdForTask(task.id)).toBe(newer.id);
  });

  it("不是任何 active project 的成员 → null", async () => {
    const task = await addTask({ title: "自由任务", toInbox: true });
    expect(await findActiveProjectGoalIdForTask(task.id)).toBeNull();
  });

  it("读裸行不过 GoalSchema：members 含重复 task ref 的行仍查得到归属", async () => {
    // GoalSchema 的 superRefine 会因单个成员重复 reject **整行**，一过 parse 就是整组归属静默失效——
    // 用户点「回收件箱」后没有任何反馈，退回本轮修的那个 bug。存量与跨设备并发都能造出这种行。
    const goal = await addGoal({ title: "装修", kind: "project" });
    const task = await addTask({ title: "刷墙", toInbox: true });
    const raw = await db.goals.get(goal.id);
    if (!raw) throw new Error("goal 不存在");
    await db.goals.put({
      ...raw,
      members: [
        { kind: "task", id: task.id },
        { kind: "task", id: task.id },
      ],
    });

    expect(await findActiveProjectGoalIdForTask(task.id)).toBe(goal.id);
  });
});

async function seedTask(id: string, patch: Record<string, unknown> = {}): Promise<void> {
  await db.tasks.add({
    id,
    parentId: null,
    title: `任务 ${id}`,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [],
    // ruleId 必须显式给 null：projectAssignBlock 判的是 `task.ruleId !== null`，
    // 缺字段读出来是 undefined，会让每条 seed 任务都被判成 recurring。
    ruleId: null,
    sessionId: null,
    skipped: false,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...patch,
  } as never);
}

async function seedProject(id: string, members: string[] = [], patch: Record<string, unknown> = {}): Promise<void> {
  await db.goals.add({
    id,
    title: `项目 ${id}`,
    kind: "project",
    status: "active",
    members: members.map((taskId) => ({ kind: "task", id: taskId })),
    prerequisites: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  } as never);
}

describe("assignTaskToProject", () => {
  it("从 A 组拖到 B 组：A 里不再有它，B 里有它（单一归属是写入侧不变量）", async () => {
    await seedTask("t1");
    await seedProject("gA", ["t1"]);
    await seedProject("gB");

    await assignTaskToProject("gB", "t1", { now: date("2026-06-22T02:00:00.000Z") });

    const a = await db.goals.get("gA");
    const b = await db.goals.get("gB");
    expect(a?.members).toEqual([]);
    expect(b?.members).toEqual([{ kind: "task", id: "t1" }]);
  });

  it("theme 目标持有同一条任务时不被摘除（归属轴排他只对 kind=project 成立）", async () => {
    await seedTask("t1");
    await seedProject("gTheme", ["t1"], { kind: "theme" });
    await seedProject("gB");

    await assignTaskToProject("gB", "t1", { now: date("2026-06-22T02:00:00.000Z") });

    const theme = await db.goals.get("gTheme");
    expect(theme?.members).toEqual([{ kind: "task", id: "t1" }]);
  });

  it("已归档的 project 也不被摘除（读侧只认 active，摘它是白写一行 syncLog）", async () => {
    await seedTask("t1");
    await seedProject("gOld", ["t1"], { status: "archived" });
    await seedProject("gB");

    await assignTaskToProject("gB", "t1", { now: date("2026-06-22T02:00:00.000Z") });

    const old = await db.goals.get("gOld");
    expect(old?.members).toEqual([{ kind: "task", id: "t1" }]);
  });

  it("目标组已归档 → 抛 inactive，且源组的成员一个没摘（否则任务失去全部有效归属）", async () => {
    await seedTask("t1");
    await seedProject("gA", ["t1"]);
    await seedProject("gArchived", [], { status: "archived" });

    await expect(assignTaskToProject("gArchived", "t1")).rejects.toMatchObject({ block: "inactive" });

    const a = await db.goals.get("gA");
    expect(a?.members).toEqual([{ kind: "task", id: "t1" }]);
    expect(await findActiveProjectGoalIdForTask("t1")).toBe("gA");
  });

  it("目标组是 theme → 抛 inactive：归属轴排他只在 kind=project 之间成立", async () => {
    await seedTask("t1");
    await seedProject("gA", ["t1"]);
    await seedProject("gTheme2", [], { kind: "theme" });

    await expect(assignTaskToProject("gTheme2", "t1")).rejects.toMatchObject({ block: "inactive" });

    const a = await db.goals.get("gA");
    expect(a?.members).toEqual([{ kind: "task", id: "t1" }]);
  });

  it("刷新成员任务 updatedAt 并记 tasks 同步日志（不刷新会让它按旧时钟沉进水下）", async () => {
    await seedTask("t1");
    await seedProject("gB");

    await assignTaskToProject("gB", "t1", { now: date("2026-06-22T02:00:00.000Z") });

    const task = await db.tasks.get("t1");
    expect(task?.updatedAt).toBe("2026-06-22T02:00:00.000Z");
    const logs = await db.syncLog.toArray();
    expect(
      logs.some((log) => log.tableName === "tasks" && log.recordId === "t1" && log.action === "update"),
    ).toBe(true);
  });

  it("子任务被拒且两侧都没写：抛 ProjectAssignError(block=subtask)", async () => {
    await seedTask("p1");
    await seedTask("t1", { parentId: "p1" });
    await seedProject("gB");

    await expect(assignTaskToProject("gB", "t1")).rejects.toBeInstanceOf(ProjectAssignError);
    const b = await db.goals.get("gB");
    expect(b?.members).toEqual([]);
  });

  it("重复模板被拒：block=recurring", async () => {
    await seedTask("t1", { recurrence: { freq: "daily", interval: 1, basis: "due" } });
    await seedProject("gB");

    await expect(assignTaskToProject("gB", "t1")).rejects.toMatchObject({ block: "recurring" });
  });

  it("occurrence 被拒：block=recurring", async () => {
    await seedTask("t1", { ruleId: "r1" });
    await seedProject("gB");

    await expect(assignTaskToProject("gB", "t1")).rejects.toMatchObject({ block: "recurring" });
  });

  it("满员被拒：block=full，错误消息带组名", async () => {
    await seedTask("t1");
    await seedProject(
      "gB",
      Array.from({ length: 500 }, (_, i) => `seed${i}`),
    );

    await expect(assignTaskToProject("gB", "t1")).rejects.toMatchObject({ block: "full" });
    await expect(assignTaskToProject("gB", "t1")).rejects.toThrow("项目 gB");
  });

  it("已在该组时幂等：不重复写成员、不抛错", async () => {
    await seedTask("t1");
    await seedProject("gB", ["t1"]);

    await assignTaskToProject("gB", "t1", { now: date("2026-06-22T02:00:00.000Z") });

    const b = await db.goals.get("gB");
    expect(b?.members).toEqual([{ kind: "task", id: "t1" }]);
  });

  it("满员的组里已有这条任务时仍幂等放行，不误报 full（重入不会让数组变长）", async () => {
    await seedTask("t1");
    await seedProject("gB", [...Array.from({ length: 499 }, (_, i) => `seed${i}`), "t1"]);

    await expect(assignTaskToProject("gB", "t1", { now: date("2026-06-22T02:00:00.000Z") })).resolves.toBeDefined();
  });

  it("任务不存在时抛错且不留半个写入", async () => {
    await seedProject("gB");
    await expect(assignTaskToProject("gB", "missing")).rejects.toThrow("任务不存在");
    const b = await db.goals.get("gB");
    expect(b?.members).toEqual([]);
  });

  it("加入失败时整包回滚：A 组的成员不能被摘掉（否则这条任务凭空消失）", async () => {
    // 事务原子性的真闸。摘除走 removeGoalMember、加入走 addGoalMember，两者各自 `db.transaction("rw", …)`；
    // 若 Dexie 没把它们并进外层事务，摘除会独立提交，加入失败后就留下「A 摘了、B 没加上」的半截状态——
    // 那条任务从两个组里同时消失，且是静默的。
    //
    // 构造「摘除成功但加入失败」：gB 的裸行 members 里含一对重复 ref（存量与跨设备并发都能造出，
    // 见 findActiveProjectGoalIdForTask 那组用例）。它长度只有 2、不触发满员闸，
    // 但 addGoalMember 内部的 GoalSchema.parse 会被 superRefine 的「goal member must be unique」拒掉。
    await seedTask("t1");
    await seedTask("dup");
    await seedProject("gA", ["t1"]);
    await seedProject("gB");
    const rawB = await db.goals.get("gB");
    if (!rawB) throw new Error("gB 不存在");
    await db.goals.put({
      ...rawB,
      members: [
        { kind: "task", id: "dup" },
        { kind: "task", id: "dup" },
      ],
    });

    await expect(assignTaskToProject("gB", "t1", { now: date("2026-06-22T02:00:00.000Z") })).rejects.toThrow();

    const a = await db.goals.get("gA");
    expect(a?.members).toEqual([{ kind: "task", id: "t1" }]);
    const b = await db.goals.get("gB");
    expect(b?.members).toEqual([
      { kind: "task", id: "dup" },
      { kind: "task", id: "dup" },
    ]);
  });
});

describe("prerequisiteLossOnAssign", () => {
  /** 一条 blocker→blocked 的前置边（星图里的「甲做完才能做乙」）。 */
  function edge(blocker: string, blocked: string) {
    return { blocker: { kind: "task", id: blocker }, blocked: { kind: "task", id: blocked } };
  }

  it("源组里有引用它的边 → 报出条数与源组名（blocker 侧与 blocked 侧都算）", async () => {
    await seedTask("t1");
    await seedTask("t2");
    await seedTask("t3");
    await seedProject("gA", ["t1", "t2", "t3"], { prerequisites: [edge("t1", "t2"), edge("t3", "t1")] });
    await seedProject("gB");

    expect(await prerequisiteLossOnAssign("t1", "gB")).toEqual({ count: 2, goalTitle: "项目 gA" });
  });

  it("源组里没有引用它的边 → null（不为一次无后果的移动弹确认）", async () => {
    await seedTask("t1");
    await seedTask("t2");
    await seedTask("t3");
    await seedProject("gA", ["t1", "t2", "t3"], { prerequisites: [edge("t2", "t3")] });
    await seedProject("gB");

    expect(await prerequisiteLossOnAssign("t1", "gB")).toBeNull();
  });

  it("源组是 theme → 不算：摘除循环根本不摘它，那些边一条都不会掉", async () => {
    await seedTask("t1");
    await seedTask("t2");
    await seedProject("gTheme", ["t1", "t2"], { kind: "theme", prerequisites: [edge("t1", "t2")] });
    await seedProject("gB");

    expect(await prerequisiteLossOnAssign("t1", "gB")).toBeNull();
  });

  it("源组已归档 → 不算：读侧不认它，摘除循环也跳过它", async () => {
    await seedTask("t1");
    await seedTask("t2");
    await seedProject("gOld", ["t1", "t2"], { status: "archived", prerequisites: [edge("t1", "t2")] });
    await seedProject("gB");

    expect(await prerequisiteLossOnAssign("t1", "gB")).toBeNull();
  });

  it("目标组自己的边不算：往回拖进它已经在的组不会摘除、边一条不掉", async () => {
    await seedTask("t1");
    await seedTask("t2");
    await seedProject("gB", ["t1", "t2"], { prerequisites: [edge("t1", "t2")] });

    expect(await prerequisiteLossOnAssign("t1", "gB")).toBeNull();
  });

  it("多个源组时条数相加，组名取边最多的那个（一句话里只塞得下一个名字）", async () => {
    await seedTask("t1");
    await seedTask("t2");
    await seedTask("t3");
    await seedProject("gFew", ["t1", "t2"], { prerequisites: [edge("t1", "t2")] });
    await seedProject("gMany", ["t1", "t2", "t3"], { prerequisites: [edge("t1", "t2"), edge("t3", "t1")] });
    await seedProject("gB");

    expect(await prerequisiteLossOnAssign("t1", "gB")).toEqual({ count: 3, goalTitle: "项目 gMany" });
  });

  it("读裸行不过 GoalSchema：members 含重复 ref 的源组照样数得出边", async () => {
    // 一过 parse，superRefine 会因单个成员重复 reject 整行，这次询问静默失效，
    // 用户在毫不知情下丢掉整组边——正是红线 3 要挡的那类失效。
    await seedTask("t1");
    await seedTask("t2");
    await seedProject("gA", [], { prerequisites: [edge("t1", "t2")] });
    const rawA = await db.goals.get("gA");
    if (!rawA) throw new Error("gA 不存在");
    await db.goals.put({
      ...rawA,
      members: [
        { kind: "task", id: "t1" },
        { kind: "task", id: "t1" },
        { kind: "task", id: "t2" },
      ],
    });
    await seedProject("gB");

    expect(await prerequisiteLossOnAssign("t1", "gB")).toEqual({ count: 1, goalTitle: "项目 gA" });
  });
});
