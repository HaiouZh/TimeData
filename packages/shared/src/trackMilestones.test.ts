import { describe, expect, it } from "vitest";
import { currentMilestone, milestoneProgress, orderMilestones } from "./trackMilestones.js";
import type { TrackMilestone } from "./types.js";

function m(over: Partial<TrackMilestone>): TrackMilestone {
  return {
    id: "m1",
    trackId: "t1",
    title: "一段",
    status: "pending",
    note: null,
    taskId: null,
    position: 0,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...over,
  };
}

describe("orderMilestones", () => {
  it("按 (position, createdAt, id) 升序，不改入参", () => {
    const a = m({ id: "a", position: 2 });
    const b = m({ id: "b", position: 1 });
    const c = m({ id: "c", position: 1, createdAt: "2026-08-19T00:00:00.000Z" });
    const input = [a, b, c];
    expect(orderMilestones(input).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("position 与 createdAt 都并列时按 id 字典序", () => {
    const x = m({ id: "x" });
    const y = m({ id: "y" });
    expect(orderMilestones([y, x]).map((v) => v.id)).toEqual(["x", "y"]);
  });
  it("空列表返回空数组且不与入参同引用", () => {
    const input: TrackMilestone[] = [];
    const out = orderMilestones(input);
    expect(out).toEqual([]);
    expect(out).not.toBe(input);
  });
});

describe("milestoneProgress", () => {
  it("dropped 从分母剔除；done 计分子", () => {
    const list = [m({ id: "a", status: "done" }), m({ id: "b" }), m({ id: "c", status: "dropped" })];
    expect(milestoneProgress(list)).toEqual({ done: 1, total: 2 });
  });
  it("空列表与全 dropped 都是 {0,0}", () => {
    expect(milestoneProgress([])).toEqual({ done: 0, total: 0 });
    expect(milestoneProgress([m({ status: "dropped" })])).toEqual({ done: 0, total: 0 });
  });
  it("全 pending 时 done 为 0，total 计全部非 dropped", () => {
    const list = [m({ id: "a" }), m({ id: "b" }), m({ id: "c", status: "done" }), m({ id: "d", status: "dropped" })];
    expect(milestoneProgress(list)).toEqual({ done: 1, total: 3 });
  });
});

describe("currentMilestone", () => {
  it("排序后第一个 pending；done 与 dropped 都不算当前段", () => {
    const list = [
      m({ id: "a", position: 0, status: "done" }),
      m({ id: "b", position: 1, status: "dropped" }),
      m({ id: "c", position: 2 }),
    ];
    expect(currentMilestone(list)?.id).toBe("c");
  });
  it("全完成返回 null", () => {
    expect(currentMilestone([m({ status: "done" })])).toBeNull();
  });
  it("空列表返回 null", () => {
    expect(currentMilestone([])).toBeNull();
  });
  it("全 dropped 返回 null", () => {
    expect(currentMilestone([m({ status: "dropped" }), m({ id: "x", status: "dropped" })])).toBeNull();
  });
});
