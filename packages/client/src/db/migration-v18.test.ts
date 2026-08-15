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

describe("Dexie v18 迁移容错：一条坏边不毁整批", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("一条坏边（null）不影响同一目标里的好边", async () => {
    await db.goals.add({
      ...GOAL_BASE,
      id: "g-1",
      prerequisites: [null, EDGE] as never,
    });

    const migrated = await migrateGoalPrerequisitesToRelations();

    expect(migrated).toBe(1);
    const rows = await db.taskRelations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      blockerKind: "task",
      blockerId: "t-1",
      blockedKind: "task",
      blockedId: "t-2",
    });
  });

  it("坏边在前、坏边在后两种顺序都不整批回滚", async () => {
    const orders: Array<Array<unknown>> = [
      [null, EDGE],
      [EDGE, null],
    ];
    for (const prerequisites of orders) {
      await resetDb();
      await db.goals.add({
        ...GOAL_BASE,
        id: "g-1",
        prerequisites: prerequisites as never,
      });

      const migrated = await migrateGoalPrerequisitesToRelations();

      expect(migrated).toBe(1);
      const rows = await db.taskRelations.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ blockerId: "t-1", blockedId: "t-2" });
    }
  });

  it("空串 id 的边被跳过，不落库、返回 0", async () => {
    await db.goals.add({
      ...GOAL_BASE,
      id: "g-1",
      prerequisites: [
        { blocker: { kind: "task" as const, id: "" }, blocked: { kind: "task" as const, id: "t-2" } },
      ],
    });

    expect(await migrateGoalPrerequisitesToRelations()).toBe(0);
    expect(await db.taskRelations.count()).toBe(0);
  });

  it("缺字段的边被跳过，不落库、返回 0", async () => {
    await db.goals.add({
      ...GOAL_BASE,
      id: "g-1",
      prerequisites: [
        { blocker: { kind: "task" as const }, blocked: { kind: "task" as const, id: "t-2" } },
      ] as never,
    });

    expect(await migrateGoalPrerequisitesToRelations()).toBe(0);
    expect(await db.taskRelations.count()).toBe(0);
  });
});

describe("Dexie v18 迁移覆盖：多目标与 createdAt", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("两个不同目标的边全部搬入（不只第一个 goal）", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await db.goals.add({
      ...GOAL_BASE,
      id: "g-2",
      prerequisites: [
        { blocker: { kind: "track" as const, id: "tk-1" }, blocked: { kind: "track" as const, id: "tk-2" } },
      ],
    });

    const migrated = await migrateGoalPrerequisitesToRelations();

    expect(migrated).toBe(2);
    const rows = await db.taskRelations.toArray();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockerKind: "task", blockerId: "t-1", blockedKind: "task", blockedId: "t-2" }),
        expect.objectContaining({ blockerKind: "track", blockerId: "tk-1", blockedKind: "track", blockedId: "tk-2" }),
      ]),
    );
  });

  it("createdAt 缺失的陈旧 goal 用迁移时刻兜底", async () => {
    const now = new Date("2026-08-02T00:00:00.000Z");
    await db.goals.add({
      ...GOAL_BASE,
      id: "g-1",
      prerequisites: [EDGE],
      createdAt: undefined as never,
    });

    const migrated = await migrateGoalPrerequisitesToRelations(now);

    expect(migrated).toBe(1);
    const rows = await db.taskRelations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("createdAt 有值时沿用 goal 的 createdAt，不是迁移时刻", async () => {
    const now = new Date("2026-08-02T00:00:00.000Z");
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });

    await migrateGoalPrerequisitesToRelations(now);

    const rows = await db.taskRelations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt).toBe(GOAL_BASE.createdAt);
  });

  it("taskRelations 的 blockerId/blockedId/updatedAt 三个二级索引可用", async () => {
    await db.taskRelations.add({
      blockerKind: "task",
      blockerId: "t-1",
      blockedKind: "task",
      blockedId: "t-2",
      type: "blocks",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const indexNames = db.taskRelations.schema.indexes.map((idx) => idx.name);
    expect(indexNames).toEqual(expect.arrayContaining(["blockerId", "blockedId", "updatedAt"]));

    const found = await db.taskRelations.where("blockedId").equals("t-2").toArray();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ blockerId: "t-1", blockedId: "t-2" });
  });
});
