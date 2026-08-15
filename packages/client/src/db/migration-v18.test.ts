import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import {
  GOAL_PREREQUISITES_SNAPSHOT_KEY,
  migrateGoalPrerequisitesToRelations,
  restoreGoalPrerequisitesFromSnapshot,
} from "./index.js";

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

  it("迁移清空 goal.prerequisites，快照里留着原样那条（回滚底牌）", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });

    await migrateGoalPrerequisitesToRelations();

    const goal = await db.goals.get("g-1");
    expect(goal?.prerequisites).toEqual([]);
    const snapshot = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
    expect(JSON.parse(snapshot?.value ?? "null")).toEqual({ "g-1": [EDGE] });
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

describe("Dexie v19：迁移清空、快照与恢复", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("迁移后裸行 prerequisites 为空数组，updatedAt 刷新成迁移时刻", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    const now = new Date("2026-08-03T00:00:00.000Z");

    await migrateGoalPrerequisitesToRelations(now);

    const goal = await db.goals.get("g-1");
    expect(goal?.prerequisites).toEqual([]);
    expect(goal?.updatedAt).toBe("2026-08-03T00:00:00.000Z");
  });

  it("清空记一条 goals/update syncLog，recordId 是该 goal 的 id", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });

    await migrateGoalPrerequisitesToRelations();

    const logs = await db.syncLog.where("tableName").equals("goals").toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ tableName: "goals", recordId: "g-1", action: "update" });
  });

  it("快照里那个 goal 的边与迁移前逐字一致（blocker/blocked 的 kind 与 id）", async () => {
    const edges = [
      { blocker: { kind: "task" as const, id: "t-1" }, blocked: { kind: "track" as const, id: "tk-9" } },
      { blocker: { kind: "track" as const, id: "tk-2" }, blocked: { kind: "task" as const, id: "t-3" } },
    ];
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: edges });

    await migrateGoalPrerequisitesToRelations();

    const snapshot = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
    expect(JSON.parse(snapshot?.value ?? "null")).toEqual({ "g-1": edges });
  });

  it("快照按 goal 合并而非覆盖：第二次迁移的新 goal 补进同一行快照", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await migrateGoalPrerequisitesToRelations();

    const g2Edge = { blocker: { kind: "track" as const, id: "tk-1" }, blocked: { kind: "track" as const, id: "tk-2" } };
    await db.goals.add({ ...GOAL_BASE, id: "g-2", prerequisites: [g2Edge] });
    await migrateGoalPrerequisitesToRelations();

    const snapshot = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
    expect(JSON.parse(snapshot?.value ?? "null")).toEqual({ "g-1": [EDGE], "g-2": [g2Edge] });
  });

  it("没有可搬的边时快照表一行都不写（goals 全空或旧字段为空）", async () => {
    expect(await migrateGoalPrerequisitesToRelations()).toBe(0);
    expect(await db.migrationSnapshots.count()).toBe(0);

    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [] });
    expect(await migrateGoalPrerequisitesToRelations()).toBe(0);
    expect(await db.migrationSnapshots.count()).toBe(0);
  });

  it("坏边也原样进快照：一条 null 边加一条好边的 goal，快照里两条都在", async () => {
    await db.goals.add({
      ...GOAL_BASE,
      id: "g-1",
      prerequisites: [null, EDGE] as never,
    });

    await migrateGoalPrerequisitesToRelations();

    const goal = await db.goals.get("g-1");
    expect(goal?.prerequisites).toEqual([]);
    const snapshot = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
    expect(JSON.parse(snapshot?.value ?? "null")).toEqual({ "g-1": [null, EDGE] });
  });

  it("恢复：跑迁移后跑恢复，快照里的边重建进关系表，restored 等于边数", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await migrateGoalPrerequisitesToRelations();
    await db.taskRelations.clear();

    const result = await restoreGoalPrerequisitesFromSnapshot();

    expect(result).toEqual({ restored: 1, failed: 0 });
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

  it("恢复不看 goal 行是否存在：快照里的 goal 已被删除，边照样重建", async () => {
    const g2Edge = { blocker: { kind: "track" as const, id: "tk-1" }, blocked: { kind: "track" as const, id: "tk-2" } };
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await db.goals.add({ ...GOAL_BASE, id: "g-2", prerequisites: [g2Edge] });
    await migrateGoalPrerequisitesToRelations();
    await db.goals.delete("g-2");
    await db.taskRelations.clear();

    const result = await restoreGoalPrerequisitesFromSnapshot();

    expect(result).toEqual({ restored: 2, failed: 0 });
    expect(await db.taskRelations.count()).toBe(2);
  });

  it("没有快照时直接跑恢复，返回 0/0 不抛异常", async () => {
    await expect(restoreGoalPrerequisitesFromSnapshot()).resolves.toEqual({ restored: 0, failed: 0 });
  });

  it("快照 JSON 损坏时恢复返回 0/0，不抛异常、不碰目标", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: "not-json{",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    await expect(restoreGoalPrerequisitesFromSnapshot()).resolves.toEqual({ restored: 0, failed: 0 });
    const goal = await db.goals.get("g-1");
    expect(goal?.prerequisites).toEqual([EDGE]);
  });

  it("快照解析出来不是对象（JSON null）时恢复返回 0/0", async () => {
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: "null",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    await expect(restoreGoalPrerequisitesFromSnapshot()).resolves.toEqual({ restored: 0, failed: 0 });
  });

  it("已有快照行损坏时迁移照常运行，本次 delta 覆盖成合法快照", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: "not-json{",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    await migrateGoalPrerequisitesToRelations();

    const snapshot = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
    expect(JSON.parse(snapshot?.value ?? "null")).toEqual({ "g-1": [EDGE] });
  });

  it("4a 重建：清空关系表模拟数据丢失后，恢复把边重建回来且逐字一致", async () => {
    const edges = [
      { blocker: { kind: "task" as const, id: "t-1" }, blocked: { kind: "track" as const, id: "tk-9" } },
      { blocker: { kind: "track" as const, id: "tk-2" }, blocked: { kind: "task" as const, id: "t-3" } },
    ];
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: edges });
    await migrateGoalPrerequisitesToRelations();

    await db.taskRelations.clear();

    const restoreNow = new Date("2026-08-05T00:00:00.000Z");
    const result = await restoreGoalPrerequisitesFromSnapshot(restoreNow);

    expect(result).toEqual({ restored: 2, failed: 0 });
    const rows = (await db.taskRelations.toArray()).map((row) => ({
      blockerKind: row.blockerKind,
      blockerId: row.blockerId,
      blockedKind: row.blockedKind,
      blockedId: row.blockedId,
      type: row.type,
    }));
    expect(rows).toEqual(
      expect.arrayContaining([
        { blockerKind: "task", blockerId: "t-1", blockedKind: "track", blockedId: "tk-9", type: "blocks" },
        { blockerKind: "track", blockerId: "tk-2", blockedKind: "task", blockedId: "t-3", type: "blocks" },
      ]),
    );
    expect(rows).toHaveLength(2);
    for (const row of await db.taskRelations.toArray()) {
      expect(row.createdAt).toBe("2026-08-05T00:00:00.000Z");
      expect(row.updatedAt).toBe("2026-08-05T00:00:00.000Z");
    }
  });

  it("4b 不碰旧字段：恢复之后裸行 prerequisites 仍是空数组", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await migrateGoalPrerequisitesToRelations();
    await db.taskRelations.clear();

    const result = await restoreGoalPrerequisitesFromSnapshot();

    expect(result).toEqual({ restored: 1, failed: 0 });
    const goal = await db.goals.get("g-1");
    expect(goal?.prerequisites).toEqual([]);
  });

  it("4c 坏边被挡：null 边计入 failed，好边照常重建", async () => {
    await db.goals.add({
      ...GOAL_BASE,
      id: "g-1",
      prerequisites: [null, EDGE] as never,
    });
    await migrateGoalPrerequisitesToRelations();
    await db.taskRelations.clear();

    const result = await restoreGoalPrerequisitesFromSnapshot();

    expect(result).toEqual({ restored: 1, failed: 1 });
    const rows = await db.taskRelations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blockerId: "t-1", blockedId: "t-2" });
  });

  it("4d 幂等：连跑两次恢复，行数与 syncLog 都不变，第二次 restored 为 0", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await migrateGoalPrerequisitesToRelations();
    await db.taskRelations.clear();
    await db.syncLog.where("tableName").equals("task_relations").delete();

    const first = await restoreGoalPrerequisitesFromSnapshot();
    const rowsAfterFirst = await db.taskRelations.count();
    const logsAfterFirst = await db.syncLog.where("tableName").equals("task_relations").count();

    const second = await restoreGoalPrerequisitesFromSnapshot();

    expect(first).toEqual({ restored: 1, failed: 0 });
    expect(second).toEqual({ restored: 0, failed: 0 });
    expect(await db.taskRelations.count()).toBe(rowsAfterFirst);
    expect(await db.syncLog.where("tableName").equals("task_relations").count()).toBe(logsAfterFirst);
  });

  it("4e 恢复后重启不被撤销：再跑一次迁移，关系表边还在、prerequisites 仍是空", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await migrateGoalPrerequisitesToRelations();
    await db.taskRelations.clear();
    await restoreGoalPrerequisitesFromSnapshot();

    await migrateGoalPrerequisitesToRelations();

    expect(await db.taskRelations.count()).toBe(1);
    const goal = await db.goals.get("g-1");
    expect(goal?.prerequisites).toEqual([]);
  });

  it("4f 坏快照另存：非法 JSON 原样留档到 corrupt key，正常 key 用本次 delta 建新行", async () => {
    const bad = "not-json{";
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: bad,
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const now = new Date("2026-08-04T00:00:00.000Z");

    await migrateGoalPrerequisitesToRelations(now);

    const rows = await db.migrationSnapshots.toArray();
    const corrupt = rows.find((row) => row.key.startsWith(`${GOAL_PREREQUISITES_SNAPSHOT_KEY}.corrupt.`));
    expect(corrupt?.value).toBe(bad);
    const normal = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
    expect(JSON.parse(normal?.value ?? "null")).toEqual({ "g-1": [EDGE] });
  });

  it("快照解析出来不是对象（JSON null）时，迁移同样把原值另存到 corrupt key", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: "null",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    await migrateGoalPrerequisitesToRelations();

    const rows = await db.migrationSnapshots.toArray();
    const corrupt = rows.find((row) => row.key.startsWith(`${GOAL_PREREQUISITES_SNAPSHOT_KEY}.corrupt.`));
    expect(corrupt?.value).toBe("null");
    const normal = await db.migrationSnapshots.get(GOAL_PREREQUISITES_SNAPSHOT_KEY);
    expect(JSON.parse(normal?.value ?? "null")).toEqual({ "g-1": [EDGE] });
  });

  it("4g 恢复记了 syncLog：新落的每条边都有一条 create 记录", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await migrateGoalPrerequisitesToRelations();
    await db.taskRelations.clear();
    await db.syncLog.where("tableName").equals("task_relations").delete();

    await restoreGoalPrerequisitesFromSnapshot();

    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: "create",
      tableName: "task_relations",
      recordId: "task|t-1|task|t-2",
    });
  });

  it("快照里某个 goal 的值为 null 时跳过该组，其余照常重建", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await migrateGoalPrerequisitesToRelations();
    await db.taskRelations.clear();
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: JSON.stringify({ "g-1": null, "g-2": [EDGE] }),
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const result = await restoreGoalPrerequisitesFromSnapshot();

    expect(result).toEqual({ restored: 1, failed: 0 });
    expect(await db.taskRelations.count()).toBe(1);
  });

  it("恢复容错：单条边落库失败不拖垮其余边，计入 failed", async () => {
    await db.goals.add({ ...GOAL_BASE, id: "g-1", prerequisites: [EDGE] });
    await db.goals.add({ ...GOAL_BASE, id: "g-2", prerequisites: [EDGE] });
    await migrateGoalPrerequisitesToRelations();
    await db.taskRelations.clear();
    await db.syncLog.where("tableName").equals("task_relations").delete();
    const putSpy = vi.spyOn(db.taskRelations, "put").mockRejectedValueOnce(new Error("写库失败"));
    try {
      const result = await restoreGoalPrerequisitesFromSnapshot();

      expect(result).toEqual({ restored: 1, failed: 1 });
      expect(await db.taskRelations.count()).toBe(1);
    } finally {
      putSpy.mockRestore();
    }
  });
});
