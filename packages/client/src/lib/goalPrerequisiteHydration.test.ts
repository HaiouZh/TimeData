import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { hydrateGoalPrerequisites, relationsToPrerequisites } from "./goalPrerequisiteHydration.js";

const baseGoal = {
  id: "g-1",
  title: "装修",
  kind: "project" as const,
  status: "active" as const,
  members: [
    { kind: "task" as const, id: "t-1" },
    { kind: "task" as const, id: "t-2" },
  ],
  prerequisites: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("relationsToPrerequisites", () => {
  it("关系行转成 GoalPrerequisite 形状", () => {
    expect(
      relationsToPrerequisites([
        {
          blockerKind: "task",
          blockerId: "t-1",
          blockedKind: "task",
          blockedId: "t-2",
          type: "blocks",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ]),
    ).toEqual([{ blocker: { kind: "task", id: "t-1" }, blocked: { kind: "task", id: "t-2" } }]);
  });
});

describe("hydrateGoalPrerequisites", () => {
  beforeEach(async () => {
    await db.taskRelations.clear();
  });

  it("把新表里的边填进 goal.prerequisites", async () => {
    await db.taskRelations.put({
      blockerKind: "task",
      blockerId: "t-1",
      blockedKind: "task",
      blockedId: "t-2",
      type: "blocks",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const [hydrated] = await hydrateGoalPrerequisites([baseGoal]);
    expect(hydrated?.prerequisites).toEqual([
      { blocker: { kind: "task", id: "t-1" }, blocked: { kind: "task", id: "t-2" } },
    ]);
  });

  it("与本目标成员无关的边不填进来", async () => {
    await db.taskRelations.put({
      blockerKind: "task",
      blockerId: "x-1",
      blockedKind: "task",
      blockedId: "x-2",
      type: "blocks",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const [hydrated] = await hydrateGoalPrerequisites([baseGoal]);
    expect(hydrated?.prerequisites).toEqual([]);
  });

  it("一头在本目标、一头在外的跨目标边会被填进来（交给 splitGoalMembers 的 ignoredPrerequisites 兜）", async () => {
    await db.taskRelations.put({
      blockerKind: "task",
      blockerId: "outsider",
      blockedKind: "task",
      blockedId: "t-2",
      type: "blocks",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const [hydrated] = await hydrateGoalPrerequisites([baseGoal]);
    expect(hydrated?.prerequisites).toEqual([
      { blocker: { kind: "task", id: "outsider" }, blocked: { kind: "task", id: "t-2" } },
    ]);
  });

  it("不改动入参对象（返回新数组）", async () => {
    const input = { ...baseGoal, prerequisites: [] };
    await hydrateGoalPrerequisites([input]);
    expect(input.prerequisites).toEqual([]);
  });

  it("关系表为空时旧字段被清空（旧字段清空后的世界；守住空表早退分支）", async () => {
    const input = { ...baseGoal, prerequisites: [{ blocker: { kind: "task", id: "t-1" }, blocked: { kind: "task", id: "t-2" } }] };

    const [hydrated] = await hydrateGoalPrerequisites([input]);
    expect(hydrated?.prerequisites).toEqual([]);
  });
});
