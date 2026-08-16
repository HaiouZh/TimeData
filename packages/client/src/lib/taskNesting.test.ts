import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { addGoal, addGoalMember, ProjectAssignError, updateGoal } from "./goals.js";
import { grabTaskToHand } from "./sessions.js";
import { addTask, createChildTask } from "./tasks.js";
import { GOAL_MEMBERS_MAX } from "./tasks/goalMembership.js";
import { nestTaskUnderParent, promoteTaskToHand, promoteTaskToProject } from "./taskNesting.js";

beforeEach(resetDb);

describe("nestTaskUnderParent", () => {
  it("收纳后退出所有含它的项目名单", async () => {
    const parent = await addTask({ title: "爹" });
    const child = await addTask({ title: "原项目成员" });
    const p1 = await addGoal({ title: "P1", kind: "project" });
    const p2 = await addGoal({ title: "P2", kind: "project" });
    await addGoalMember(p1.id, { kind: "task", id: child.id });
    await addGoalMember(p2.id, { kind: "task", id: child.id });

    await nestTaskUnderParent(child.id, parent.id);

    expect((await db.goals.get(p1.id))?.members ?? []).toHaveLength(0);
    expect((await db.goals.get(p2.id))?.members ?? []).toHaveLength(0);
    expect((await db.tasks.get(child.id))?.parentId).toBe(parent.id);
  });

  it("跨项目收纳：退出 P1，不进 P2", async () => {
    const p1 = await addGoal({ title: "P1", kind: "project" });
    const p2 = await addGoal({ title: "P2", kind: "project" });
    const parent = await addTask({ title: "P2 的爹" });
    const child = await addTask({ title: "P1 的活" });
    await addGoalMember(p2.id, { kind: "task", id: parent.id });
    await addGoalMember(p1.id, { kind: "task", id: child.id });

    await nestTaskUnderParent(child.id, parent.id);

    const g1Members = (await db.goals.get(p1.id))?.members ?? [];
    const g2Members = (await db.goals.get(p2.id))?.members ?? [];
    expect(g1Members.some((m) => m.id === child.id)).toBe(false);
    expect(g2Members.some((m) => m.id === child.id)).toBe(false);
    // 爹自己的归属不受影响——清的只是被收纳那条
    expect(g2Members.some((m) => m.id === parent.id)).toBe(true);
  });

  it("同时清掉手头场指针", async () => {
    const parent = await addTask({ title: "爹" });
    const child = await addTask({ title: "手头的活" });
    await grabTaskToHand(child.id);

    await nestTaskUnderParent(child.id, parent.id);

    expect((await db.tasks.get(child.id))?.sessionId ?? null).toBeNull();
  });

  it("降级被拒时项目名单不变（原子性：不留幽灵）", async () => {
    const parent = await addTask({ title: "爹" });
    const child = await addTask({ title: "自己有娃的活" });
    const p1 = await addGoal({ title: "P1", kind: "project" });
    await addGoalMember(p1.id, { kind: "task", id: child.id });
    // child 自己带一个子任务 → 触发 CANNOT_DEMOTE_ROOT_WITH_CHILDREN
    await createChildTask(child.id, "孙子");

    await expect(nestTaskUnderParent(child.id, parent.id)).rejects.toThrow();

    expect((await db.tasks.get(child.id))?.parentId ?? null).toBeNull();
    expect((await db.goals.get(p1.id))?.members ?? []).toHaveLength(1);
  });
});

describe("promoteTaskToHand", () => {
  it("升为根任务并站到手头，且不顺手排今天", async () => {
    const parent = await addTask({ title: "爹" });
    await grabTaskToHand(parent.id);
    const child = await createChildTask(parent.id, "将被拽出的子任务");

    await promoteTaskToHand(child.id, 99);

    const after = await db.tasks.get(child.id);
    expect(after?.parentId ?? null).toBeNull();
    expect(after?.sessionId).toBe((await db.sessions.toArray())[0]?.id);
    expect(after?.scheduledAt ?? null).toBeNull();
  });

  it("无活跃场时零仪式开场", async () => {
    const parent = await addTask({ title: "爹" });
    const child = await createChildTask(parent.id, "子任务");
    expect(await db.sessions.count()).toBe(0);

    await promoteTaskToHand(child.id, 0);

    expect(await db.sessions.count()).toBe(1);
    expect((await db.tasks.get(child.id))?.sessionId).toBe((await db.sessions.toArray())[0]?.id);
  });
});

describe("promoteTaskToProject", () => {
  it("升为根任务并回到指定项目组，不顺手排今天", async () => {
    const p1 = await addGoal({ title: "P1", kind: "project" });
    const parent = await addTask({ title: "爹" });
    await addGoalMember(p1.id, { kind: "task", id: parent.id });
    const child = await createChildTask(parent.id, "子步骤");

    await promoteTaskToProject(child.id, p1.id, 7);

    const row = await db.tasks.get(child.id);
    expect(row?.parentId ?? null).toBeNull();
    // 抓回组与排期正交：promoteToRoot 落 "inbox"，不写 scheduledAt
    expect(row?.scheduledAt ?? null).toBeNull();
    expect(row?.sortOrder).toBe(7);
    const members = (await db.goals.get(p1.id))?.members ?? [];
    expect(members.some((m) => m.id === child.id)).toBe(true);
  });

  it("子任务升根后入组成功（阶段3 起不再有 subtask 准入闸）", async () => {
    const p1 = await addGoal({ title: "P1", kind: "project" });
    const parent = await addTask({ title: "爹" });
    const child = await createChildTask(parent.id, "子步骤");

    await expect(promoteTaskToProject(child.id, p1.id, 0)).resolves.toBeUndefined();
  });

  it("目标组已归档 → 抛 ProjectAssignError，任务停在「已升根、未入组」的可见态", async () => {
    const p1 = await addGoal({ title: "P1", kind: "project" });
    const parent = await addTask({ title: "爹" });
    const child = await createChildTask(parent.id, "子步骤");
    await updateGoal(p1.id, { status: "archived" });

    await expect(promoteTaskToProject(child.id, p1.id, 0)).rejects.toBeInstanceOf(ProjectAssignError);

    // 第一步已生效且可见：它是收件箱里一条独立任务，不是投影层查不到的幽灵态
    const row = await db.tasks.get(child.id);
    expect(row?.parentId ?? null).toBeNull();
    expect((await db.goals.get(p1.id))?.members ?? []).toHaveLength(0);
  });

  it("目标组满员 → 抛 full", async () => {
    const p1 = await addGoal({ title: "P1", kind: "project" });
    const parent = await addTask({ title: "爹" });
    const child = await createChildTask(parent.id, "子步骤");
    // 500 个悬空 track ref：成员数看的是原始数组长度，不要求这些 track 真实存在
    await db.goals.update(p1.id, {
      members: Array.from({ length: GOAL_MEMBERS_MAX }, (_, i) => ({ kind: "track" as const, id: `tr-${i}` })),
    });

    await expect(promoteTaskToProject(child.id, p1.id, 0)).rejects.toMatchObject({ block: "full" });
  });
});

describe("收纳仍清项目归属（阶段3 拍板不变）", () => {
  it("把已归项目的任务收纳成子任务后，它不再占项目名单", async () => {
    const parent = await addTask({ title: "爹" });
    const child = await addTask({ title: "项目成员" });
    const g = await addGoal({ title: "P1", kind: "project" });
    await addGoalMember(g.id, { kind: "task", id: child.id });

    await nestTaskUnderParent(child.id, parent.id);

    const members = (await db.goals.get(g.id))?.members ?? [];
    expect(members.some((m) => m.id === child.id)).toBe(false);
    expect((await db.tasks.get(child.id))?.parentId).toBe(parent.id);
  });
});
