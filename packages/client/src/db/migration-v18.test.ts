import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { migrateGoalPrerequisitesToRelations } from "./index.js";

const GOAL_BASE = {
  title: "装修",
  kind: "project" as const,
  status: "active" as const,
  members: [
    { kind: "task" as const, id: "t-1" },
    { kind: "task" as const, id: "t-2" },
  ],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const EDGE = {
  blocker: { kind: "task" as const, id: "t-1" },
  blocked: { kind: "task" as const, id: "t-2" },
};

describe("Dexie v18：goal.prerequisites 搬进 taskRelations", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("存量目标的每条前置边都落成一行关系", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });

    const migrated = await migrateGoalPrerequisitesToRelations();

    expect(migrated).toBe(1);
    const rows = await db.taskRelations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      blockerKind: "task",
      blockerId: "t-1",
      blockedKind: "task",
      blockedId: "t-2",
      type: "blocks",
    });
  });

  it("迁移不删除 goal.prerequisites（回滚底牌）", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });

    await migrateGoalPrerequisitesToRelations();

    const goal = await db.goals.get("g-1");
    expect(goal?.prerequisites).toHaveLength(1);
  });

  it("两个目标里的同一条边只落一行（复合主键去重）", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await db.goals.add({ ...GOAL_BASE, id: "g-2", prerequisites: [EDGE] });

    await migrateGoalPrerequisitesToRelations();

    expect(await db.taskRelations.count()).toBe(1);
  });

  it("重复跑是幂等的，不产生重复行也不重复记 syncLog", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });

    await migrateGoalPrerequisitesToRelations();
    const secondRun = await migrateGoalPrerequisitesToRelations();

    expect(secondRun).toBe(0);
    expect(await db.taskRelations.count()).toBe(1);
    expect(await db.syncLog.where("tableName").equals("task_relations").count()).toBe(1);
  });

  it("没有前置边时不写入、返回 0", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [] });

    expect(await migrateGoalPrerequisitesToRelations()).toBe(0);
    expect(await db.taskRelations.count()).toBe(0);
  });

  it("每搬一条边就记一条 create syncLog", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });

    await migrateGoalPrerequisitesToRelations();

    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("create");
  });
});
