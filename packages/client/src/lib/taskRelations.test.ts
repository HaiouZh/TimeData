import { beforeEach, describe, expect, it } from "vitest";
import { type Goal, GoalSchema } from "@timedata/shared";
import { db } from "../db/index.js";
import {
  addTaskRelation,
  buildBlockedByIndex,
  listRelationsBlocking,
  listTaskRelations,
  removeTaskRelation,
  removeTaskRelationsForInCurrentTransaction,
  removeTaskRelationsWithinScopeInCurrentTransaction,
  wouldCreateCycle,
} from "./taskRelations.js";

const t = (id: string) => ({ kind: "task" as const, id });
const tr = (id: string) => ({ kind: "track" as const, id });

function makeGoal(id: string, memberIds: string[]): Goal {
  return GoalSchema.parse({
    id,
    title: `目标 ${id}`,
    kind: "project",
    status: "active",
    members: memberIds.map((memberId) => ({ kind: "task", id: memberId })),
    prerequisites: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
}

function relation(blockerId: string, blockedId: string) {
  return {
    blockerKind: "task" as const,
    blockerId,
    blockedKind: "task" as const,
    blockedId,
    type: "blocks" as const,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("wouldCreateCycle", () => {
  it("直接自反算环", () => {
    expect(wouldCreateCycle([], t("a"), t("a"))).toBe(true);
  });

  it("A→B 已存在时再加 B→A 算环", () => {
    expect(wouldCreateCycle([relation("a", "b")], t("b"), t("a"))).toBe(true);
  });

  it("A→B→C 已存在时再加 C→A 算环", () => {
    expect(wouldCreateCycle([relation("a", "b"), relation("b", "c")], t("c"), t("a"))).toBe(true);
  });

  it("不成环的边返回 false", () => {
    expect(wouldCreateCycle([relation("a", "b")], t("a"), t("c"))).toBe(false);
  });
});

describe("addTaskRelation", () => {
  beforeEach(async () => {
    await db.taskRelations.clear();
    await db.syncLog.clear();
  });

  it("连边落库并记 syncLog", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });

    expect(await db.taskRelations.count()).toBe(1);
    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("create");
  });

  it("重复连同一条边不产生第二行", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });

    expect(await db.taskRelations.count()).toBe(1);
  });

  it("重复连同一条边不重复记 syncLog", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });

    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("create");
  });

  it("自己等自己被拒", async () => {
    await expect(addTaskRelation({ blocker: t("a"), blocked: t("a") })).rejects.toThrow(
      /RELATION_SELF_REFERENCE/,
    );
    expect(await db.taskRelations.count()).toBe(0);
  });

  it("会成环的边被拒，且不落库", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await expect(addTaskRelation({ blocker: t("b"), blocked: t("a") })).rejects.toThrow(
      /RELATION_WOULD_CREATE_CYCLE/,
    );
    expect(await db.taskRelations.count()).toBe(1);
  });
});

describe("removeTaskRelation", () => {
  beforeEach(async () => {
    await db.taskRelations.clear();
    await db.syncLog.clear();
  });

  it("断边删行并记 delete syncLog", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await db.syncLog.clear();

    await removeTaskRelation({ blocker: t("a"), blocked: t("b") });

    expect(await db.taskRelations.count()).toBe(0);
    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs[0]?.action).toBe("delete");
  });

  it("断不存在的边是 no-op，不记 syncLog", async () => {
    await removeTaskRelation({ blocker: t("a"), blocked: t("b") });
    expect(await db.syncLog.where("tableName").equals("task_relations").count()).toBe(0);
  });
});

describe("removeTaskRelationsForInCurrentTransaction", () => {
  beforeEach(async () => {
    await db.taskRelations.clear();
    await db.syncLog.clear();
  });

  it("ref 作为 blocker 参与的边全部被删并记 delete syncLog", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await addTaskRelation({ blocker: t("a"), blocked: t("c") });
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsForInCurrentTransaction(t("a"));
    });

    expect(await db.taskRelations.count()).toBe(0);
    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.action === "delete")).toBe(true);
  });

  it("ref 作为 blocked 参与的边全部被删并记 delete syncLog", async () => {
    await addTaskRelation({ blocker: t("b"), blocked: t("a") });
    await addTaskRelation({ blocker: t("c"), blocked: t("a") });
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsForInCurrentTransaction(t("a"));
    });

    expect(await db.taskRelations.count()).toBe(0);
    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.action === "delete")).toBe(true);
  });

  it("无关的边不受影响", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await addTaskRelation({ blocker: t("x"), blocked: t("y") });
    await addTaskRelation({ blocker: t("x"), blocked: t("z") });
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsForInCurrentTransaction(t("a"));
    });

    expect(await db.taskRelations.count()).toBe(2);
    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("delete");
    expect(logs[0]?.recordId).toBe("task|a|task|b");
  });

  it("ref 同时作为 blocker 与 blocked 参与的混合边全部被删", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await addTaskRelation({ blocker: t("c"), blocked: t("a") });
    await addTaskRelation({ blocker: t("x"), blocked: t("y") });
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsForInCurrentTransaction(t("a"));
    });

    expect(await db.taskRelations.count()).toBe(1);
    const remaining = await listTaskRelations();
    expect(remaining[0]?.blockerId).toBe("x");
    expect(remaining[0]?.blockedId).toBe("y");
    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.action === "delete")).toBe(true);
  });
});

describe("removeTaskRelationsWithinScopeInCurrentTransaction", () => {
  beforeEach(async () => {
    await db.taskRelations.clear();
    await db.syncLog.clear();
    await db.goals.clear();
  });

  // 关系表一条边全局一行——同一对端点同时是两个目标的成员时，两边共用这一行（迁移专门做过
  // 这个去重，是支持的存量形态）。旧模型下 A、B 各持一份副本，删 A 的不影响 B；换成全局一行后，
  // 只按「两端都在本目标内」判就会连坐：从 A 移出成员，B 的星图箭头无声消失、零提示。
  it("这条边还落在别的目标的成员范围内 → 不删（另一个目标的连线不连坐）", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    // 目标 B 的成员同样包含这条边的两端
    await db.goals.add(makeGoal("goal-b", ["a", "b"]));
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsWithinScopeInCurrentTransaction(new Set(["task:a", "task:b"]), t("a"), "goal-a");
    });

    expect(await db.taskRelations.count()).toBe(1);
    expect(await db.syncLog.where("tableName").equals("task_relations").count()).toBe(0);
  });

  it("别的目标只包含边的一端 → 照删（那个目标本来就没有这条边）", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    // 目标 B 只有 a，没有 b —— 这条边不在 B 的范围内，B 的图上本来就没有它
    await db.goals.add(makeGoal("goal-b", ["a"]));
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsWithinScopeInCurrentTransaction(new Set(["task:a", "task:b"]), t("a"), "goal-a");
    });

    expect(await db.taskRelations.count()).toBe(0);
    expect(await db.syncLog.where("tableName").equals("task_relations").count()).toBe(1);
  });

  it("发起清边的目标自己不算「别的目标」 → 照删", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    // 库里就是发起方自己那条 goal 行（移出成员时它还没落库到新成员表，但即便落了也不该拦自己）
    await db.goals.add(makeGoal("goal-a", ["a", "b"]));
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsWithinScopeInCurrentTransaction(new Set(["task:a", "task:b"]), t("a"), "goal-a");
    });

    expect(await db.taskRelations.count()).toBe(0);
  });

  it("两端都在 memberKeys 内且一端是 ref → 删，并记 delete syncLog", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await addTaskRelation({ blocker: t("a"), blocked: t("c") });
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsWithinScopeInCurrentTransaction(new Set(["task:a", "task:b"]), t("a"), "goal-a");
    });

    expect(await db.taskRelations.count()).toBe(1);
    const remaining = await listTaskRelations();
    expect(remaining[0]?.blockedId).toBe("c");
    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("delete");
  });

  it("一端在 memberKeys 外 → 不删，不记 syncLog", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsWithinScopeInCurrentTransaction(new Set(["task:a"]), t("a"), "goal-a");
    });

    expect(await db.taskRelations.count()).toBe(1);
    expect(await db.syncLog.where("tableName").equals("task_relations").count()).toBe(0);
  });

  it("两端都在范围内但都不是 ref → 不删，不记 syncLog", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsWithinScopeInCurrentTransaction(new Set(["task:a", "task:b"]), t("c"), "goal-a");
    });

    expect(await db.taskRelations.count()).toBe(1);
    expect(await db.syncLog.where("tableName").equals("task_relations").count()).toBe(0);
  });

  it("范围内涉及 ref 的每条删除都记一条 delete syncLog，范围外的不动", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await addTaskRelation({ blocker: t("a"), blocked: t("c") });
    await addTaskRelation({ blocker: t("a"), blocked: t("x") });
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsWithinScopeInCurrentTransaction(new Set(["task:a", "task:b", "task:c"]), t("a"));
    });

    expect(await db.taskRelations.count()).toBe(1);
    const remaining = await listTaskRelations();
    expect(remaining[0]?.blockedId).toBe("x");
    const logs = await db.syncLog.where("tableName").equals("task_relations").toArray();
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.action === "delete")).toBe(true);
  });

  it("ref 按 kind+id 整体匹配：task:a 与 track:a 不是同一个端点", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await db.syncLog.clear();

    await db.transaction("rw", db.taskRelations, db.syncLog, db.goals, async () => {
      await removeTaskRelationsWithinScopeInCurrentTransaction(new Set(["task:a", "task:b"]), tr("a"));
    });

    expect(await db.taskRelations.count()).toBe(1);
    expect(await db.syncLog.where("tableName").equals("task_relations").count()).toBe(0);
  });
});

describe("listRelationsBlocking", () => {
  beforeEach(async () => {
    await db.taskRelations.clear();
  });

  it("只返回挡住指定目标的边", async () => {
    await addTaskRelation({ blocker: t("a"), blocked: t("b") });
    await addTaskRelation({ blocker: t("c"), blocked: t("b") });
    await addTaskRelation({ blocker: t("a"), blocked: t("z") });

    const blocking = await listRelationsBlocking(t("b"));
    expect(blocking.map((r) => r.blockerId).sort()).toEqual(["a", "c"]);
  });
});

describe("listTaskRelations", () => {
  it("空表返回空数组", async () => {
    await db.taskRelations.clear();
    expect(await listTaskRelations()).toEqual([]);
  });
});

describe("kind 区分（同 id 不同 kind 是不同端点）", () => {
  beforeEach(async () => {
    await db.taskRelations.clear();
    await db.syncLog.clear();
  });

  it("连边：task:x 与 track:x 是两行，互不覆盖", async () => {
    await addTaskRelation({ blocker: t("x"), blocked: t("y") });
    await addTaskRelation({ blocker: tr("x"), blocked: t("y") });

    expect(await db.taskRelations.count()).toBe(2);
  });

  it("断边：断 task:x 的边不影响 track:x 的边", async () => {
    await addTaskRelation({ blocker: t("x"), blocked: t("y") });
    await addTaskRelation({ blocker: tr("x"), blocked: t("y") });
    await db.syncLog.clear();

    await removeTaskRelation({ blocker: t("x"), blocked: t("y") });

    expect(await db.taskRelations.count()).toBe(1);
    const remaining = await listTaskRelations();
    expect(remaining[0]?.blockerKind).toBe("track");
    expect(remaining[0]?.blockerId).toBe("x");
  });

  it("listRelationsBlocking：blocked 端按 kind+id 整体匹配", async () => {
    await addTaskRelation({ blocker: t("x"), blocked: t("y") });
    await addTaskRelation({ blocker: tr("x"), blocked: tr("y") });

    const blockingTask = await listRelationsBlocking(t("y"));
    expect(blockingTask).toHaveLength(1);
    expect(blockingTask[0]?.blockerKind).toBe("task");

    const blockingTrack = await listRelationsBlocking(tr("y"));
    expect(blockingTrack).toHaveLength(1);
    expect(blockingTrack[0]?.blockerKind).toBe("track");
  });
});

describe("wouldCreateCycle 跨 kind", () => {
  it("task → track → task 的链能走通，判定为环", () => {
    const taskToTrack = {
      ...relation("a", "m"),
      blockedKind: "track" as const,
    };
    const trackToTask = {
      ...relation("m", "b"),
      blockerKind: "track" as const,
    };

    expect(wouldCreateCycle([taskToTrack, trackToTask], t("b"), t("a"))).toBe(true);
  });

  it("跨 kind 的无环链返回 false", () => {
    const taskToTrack = {
      ...relation("a", "m"),
      blockedKind: "track" as const,
    };
    const trackToTask = {
      ...relation("m", "b"),
      blockerKind: "track" as const,
    };

    expect(wouldCreateCycle([taskToTrack, trackToTask], t("a"), t("c"))).toBe(false);
  });
});

describe("buildBlockedByIndex", () => {
  it("blocker 存在且未完成 → 算挡", () => {
    const index = buildBlockedByIndex(
      [relation("t1", "t2")],
      new Set(),
      new Set(["task:t1", "task:t2"]),
    );
    expect(index.get("task:t2")).toEqual(["task:t1"]);
  });

  it("blocker 已完成 → 不算挡（既有行为，别回归）", () => {
    const index = buildBlockedByIndex(
      [relation("t1", "t2")],
      new Set(["task:t1"]),
      new Set(["task:t1", "task:t2"]),
    );
    expect(index.has("task:t2")).toBe(false);
  });

  it("blocker 已不存在（悬空边）→ 不算挡", () => {
    const index = buildBlockedByIndex(
      [relation("gone", "t2")],
      new Set(),
      new Set(["task:t2"]),
    );
    expect(index.has("task:t2")).toBe(false);
  });

  it("一条被两个前置挡，只剩活着的那个", () => {
    const index = buildBlockedByIndex(
      [relation("gone", "t2"), relation("t1", "t2")],
      new Set(),
      new Set(["task:t1", "task:t2"]),
    );
    expect(index.get("task:t2")).toEqual(["task:t1"]);
  });

  it("轨道端同样按存活筛：已删轨道不算挡", () => {
    const index = buildBlockedByIndex(
      [{ ...relation("x", "t2"), blockerKind: "track" as const, blockerId: "trGone" }],
      new Set(),
      new Set(["task:t2"]),
    );
    expect(index.has("task:t2")).toBe(false);
  });
});
