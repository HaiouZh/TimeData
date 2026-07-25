import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import {
  addGoal,
  addGoalMember,
  addTaskForGoal,
  deleteGoal,
  findActiveProjectGoalIdForTask,
  getGoal,
  listGoals,
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
