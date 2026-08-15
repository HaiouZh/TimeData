import { beforeEach, describe, expect, it } from "vitest";
import type { Goal } from "@timedata/shared";
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

  it("一头在本目标、一头在外的跨目标边不填进来（图渲染会把它画成 ghost 断裂边，不属任何目标的视图）", async () => {
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
    expect(hydrated?.prerequisites).toEqual([]);
  });

  it("blocker 端在成员内、blocked 端在外时不填进来（只判一端就收的变异会被本条逮住）", async () => {
    await db.taskRelations.put({
      blockerKind: "task",
      blockerId: "t-1",
      blockedKind: "task",
      blockedId: "outsider",
      type: "blocks",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const [hydrated] = await hydrateGoalPrerequisites([baseGoal]);
    expect(hydrated?.prerequisites).toEqual([]);
  });

  it("不改动入参对象（返回新数组）", async () => {
    const input = { ...baseGoal, prerequisites: [] };
    await hydrateGoalPrerequisites([input]);
    expect(input.prerequisites).toEqual([]);
  });

  it("task 成员与 track 成员共用 id 字符串时不误判 kind", async () => {
    // 两个目标各有一个 id 为 "shared" 的成员，kind 分别是 task 与 track（轨道与任务 id 恰好撞车）。
    // 边引用的是 track 那份——memberKey 若丢掉 kind 只用 id，task 目标会因为同 id 误命中。
    await db.taskRelations.put({
      blockerKind: "track",
      blockerId: "shared",
      blockedKind: "task",
      blockedId: "t-2",
      type: "blocks",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const taskGoal = { ...baseGoal, members: [{ kind: "task", id: "shared" }, { kind: "task", id: "t-2" }] };
    const trackGoal = {
      ...baseGoal,
      id: "g-2",
      members: [{ kind: "track", id: "shared" }, { kind: "task", id: "t-2" }],
    };
    const [a, b] = await hydrateGoalPrerequisites([taskGoal, trackGoal]);
    expect(a?.prerequisites).toEqual([]);
    expect(b?.prerequisites).toEqual([
      { blocker: { kind: "track", id: "shared" }, blocked: { kind: "task", id: "t-2" } },
    ]);
  });

  it("members 为 undefined 的裸行 goal 不抛异常、收边为空", async () => {
    // 生产里"裸行"——没过 GoalSchema 解析就进了 hydrate 的数据，members 字段可能整块缺失。
    await db.taskRelations.put({
      blockerKind: "task",
      blockerId: "t-1",
      blockedKind: "task",
      blockedId: "t-2",
      type: "blocks",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const [hydrated] = await hydrateGoalPrerequisites([{ ...baseGoal, members: undefined } as unknown as Goal]);
    expect(hydrated?.prerequisites).toEqual([]);
  });

  it("关系表为空时旧字段被清空（旧字段清空后的世界；守住空表早退分支）", async () => {
    const input = { ...baseGoal, prerequisites: [{ blocker: { kind: "task", id: "t-1" }, blocked: { kind: "task", id: "t-2" } }] };

    const [hydrated] = await hydrateGoalPrerequisites([input]);
    expect(hydrated?.prerequisites).toEqual([]);
  });
});
