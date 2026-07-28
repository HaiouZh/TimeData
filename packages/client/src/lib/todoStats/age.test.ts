import { TaskSchema, type Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { ageBuckets } from "./age.js";

let taskSeq = 0;
function makeTask(overrides: Partial<Task> & { id: string }): Task {
  taskSeq += 1;
  return TaskSchema.parse({
    parentId: null,
    title: `任务${taskSeq}`,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [],
    ruleId: null,
    sessionId: null,
    skipped: false,
    sortOrder: taskSeq,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  });
}

const NOW = new Date("2026-07-24T00:00:00.000Z");

function daysAgoIso(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("ageBuckets", () => {
  it("恰 7 天整归入 7-30 天桶（左闭右开）", () => {
    const task = makeTask({ id: "t7", createdAt: daysAgoIso(7) });
    const result = ageBuckets([task], NOW);
    const bucket730 = result.find((b) => b.label === "7-30天")!;
    const bucketUnder7 = result.find((b) => b.label === "<7天")!;
    expect(bucket730.count).toBe(1);
    expect(bucketUnder7.count).toBe(0);
  });

  it("恰 30 天整归入 30-90 天桶（左闭右开）", () => {
    const task = makeTask({ id: "t30", createdAt: daysAgoIso(30) });
    const result = ageBuckets([task], NOW);
    const bucket3090 = result.find((b) => b.label === "30-90天")!;
    const bucket730 = result.find((b) => b.label === "7-30天")!;
    expect(bucket3090.count).toBe(1);
    expect(bucket730.count).toBe(0);
  });

  it("恰 90 天整归入 >90 天桶（左闭右开）", () => {
    const task = makeTask({ id: "t90", createdAt: daysAgoIso(90) });
    const result = ageBuckets([task], NOW);
    const bucketOver90 = result.find((b) => b.label === ">90天")!;
    const bucket3090 = result.find((b) => b.label === "30-90天")!;
    expect(bucketOver90.count).toBe(1);
    expect(bucket3090.count).toBe(0);
  });

  it("6.9 天归入 <7天 桶", () => {
    const task = makeTask({ id: "t6", createdAt: daysAgoIso(6.9) });
    const result = ageBuckets([task], NOW);
    const bucketUnder7 = result.find((b) => b.label === "<7天")!;
    expect(bucketUnder7.count).toBe(1);
  });

  it("重复模板行（recurrence≠null）排除，不进任何桶", () => {
    const template = makeTask({ id: "tpl", recurrence: { freq: "daily", interval: 1, basis: "due" }, createdAt: daysAgoIso(1) });
    const result = ageBuckets([template], NOW);
    const total = result.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(0);
  });

  it("已完成任务（done=true）不计入年龄分布", () => {
    const task = makeTask({ id: "done1", done: true, completedAt: NOW.toISOString(), createdAt: daysAgoIso(1) });
    const result = ageBuckets([task], NOW);
    const total = result.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(0);
  });

  it("occurrence 行（ruleId≠null）不算创建事件，不计入", () => {
    const occ = makeTask({ id: "occ", ruleId: "r1", createdAt: daysAgoIso(1) });
    const result = ageBuckets([occ], NOW);
    const total = result.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(0);
  });

  it("oldest 是全局最老 5 条（按创建时间升序），每个桶携带同一份全局列表", () => {
    const tasks = [
      makeTask({ id: "a", createdAt: daysAgoIso(1) }),
      makeTask({ id: "b", createdAt: daysAgoIso(100) }),
      makeTask({ id: "c", createdAt: daysAgoIso(50) }),
      makeTask({ id: "d", createdAt: daysAgoIso(40) }),
      makeTask({ id: "e", createdAt: daysAgoIso(35) }),
      makeTask({ id: "f", createdAt: daysAgoIso(10) }),
    ];
    const result = ageBuckets(tasks, NOW);
    for (const bucket of result) {
      expect(bucket.oldest.map((o) => o.id)).toEqual(["b", "c", "d", "e", "f"]);
    }
  });

  it("四个桶标签齐全，即使为空", () => {
    const result = ageBuckets([], NOW);
    expect(result.map((b) => b.label)).toEqual(["<7天", "7-30天", "30-90天", ">90天"]);
  });
});
