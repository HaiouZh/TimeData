import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { addGoal, addGoalMember } from "./goals.js";
import { grabTaskToHand } from "./sessions.js";
import { addTask, createChildTask } from "./tasks.js";
import { nestTaskUnderParent, promoteTaskToHand } from "./taskNesting.js";

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
