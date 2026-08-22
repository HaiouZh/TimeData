import { describe, expect, it } from "vitest";
import type { Task, Track } from "@timedata/shared";
import { blockerCandidateContext, filterBlockerCandidates } from "./blockerCandidates.js";

function task(patch: Partial<Task> & Pick<Task, "id">): Task {
  return {
    title: `任务 ${patch.id}`,
    done: false,
    parentId: null,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    weight: 0,
    ruleId: null,
    sessionId: null,
    skipped: false,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  } as Task;
}

function track(patch: Partial<Track> & Pick<Track, "id">): Track {
  return {
    title: `轨道 ${patch.id}`,
    status: "active",
    refs: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  } as Track;
}

describe("filterBlockerCandidates", () => {
  it("过滤已完成的任务", () => {
    const tasks = [task({ id: "done", done: true }), task({ id: "alive" })];
    const result = filterBlockerCandidates({
      tasks,
      tracks: [],
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    expect(result.tasks.map((t) => t.id)).toEqual(["alive"]);
  });

  it("过滤自己", () => {
    const tasks = [task({ id: "self" }), task({ id: "other" })];
    const result = filterBlockerCandidates({
      tasks,
      tracks: [],
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    expect(result.tasks.map((t) => t.id)).not.toContain("self");
    expect(result.tasks.map((t) => t.id)).toEqual(["other"]);
  });

  it("过滤已有前置的任务与轨道", () => {
    const tasks = [task({ id: "a" }), task({ id: "b" })];
    const tracks = [track({ id: "tr1" }), track({ id: "tr2" })];
    const result = filterBlockerCandidates({
      tasks,
      tracks,
      selfTaskId: "self",
      existingBlockerKeys: new Set(["task:a", "track:tr1"]),
      query: "",
    });
    expect(result.tasks.map((t) => t.id)).toEqual(["b"]);
    expect(result.tracks.map((t) => t.id)).toEqual(["tr2"]);
  });

  it("过滤 occurrence（ruleId 非空）", () => {
    const tasks = [task({ id: "occ", ruleId: "r1" }), task({ id: "normal" })];
    const result = filterBlockerCandidates({
      tasks,
      tracks: [],
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    expect(result.tasks.map((t) => t.id)).toEqual(["normal"]);
  });

  it("过滤重复模板（recurrence 非空）", () => {
    const tasks = [
      task({ id: "tmpl", recurrence: { freq: "daily", interval: 1, basis: "due" } as Task["recurrence"] }),
      task({ id: "normal" }),
    ];
    const result = filterBlockerCandidates({
      tasks,
      tracks: [],
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    expect(result.tasks.map((t) => t.id)).toEqual(["normal"]);
  });

  it("任务按 updatedAt 字符串倒序", () => {
    const tasks = [
      task({ id: "old", updatedAt: "2026-06-01T00:00:00.000Z" }),
      task({ id: "new", updatedAt: "2026-06-10T00:00:00.000Z" }),
      task({ id: "mid", updatedAt: "2026-06-05T00:00:00.000Z" }),
    ];
    const result = filterBlockerCandidates({
      tasks,
      tracks: [],
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    expect(result.tasks.map((t) => t.id)).toEqual(["new", "mid", "old"]);
  });

  it("query 大小写不敏感命中", () => {
    const tasks = [task({ id: "1", title: "Alpha Task" }), task({ id: "2", title: "beta task" })];
    const result = filterBlockerCandidates({
      tasks,
      tracks: [],
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "ALPHA",
    });
    expect(result.tasks.map((t) => t.id)).toEqual(["1"]);
  });

  it("query 空串（trim 后空）返回全量", () => {
    const tasks = [task({ id: "1" }), task({ id: "2" })];
    const tracks = [track({ id: "tr1" }), track({ id: "tr2" })];
    const result = filterBlockerCandidates({
      tasks,
      tracks,
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "   ",
    });
    expect(result.tasks.length).toBe(2);
    expect(result.tracks.length).toBe(2);
  });

  it("轨道非 active 被滤", () => {
    const tracks = [track({ id: "active" }), track({ id: "parked", status: "parked" as Track["status"] })];
    const result = filterBlockerCandidates({
      tasks: [],
      tracks,
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    expect(result.tracks.map((t) => t.id)).toEqual(["active"]);
  });

  it("标题命中 query 才保留，轨道保持传入序", () => {
    const tracks = [track({ id: "trA", title: "Zoom Sprint" }), track({ id: "trB", title: "Alpha" })];
    const result = filterBlockerCandidates({
      tasks: [],
      tracks,
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "alpha",
    });
    expect(result.tracks.map((t) => t.id)).toEqual(["trB"]);
    // 传入序保持：若不过滤 query，顺序应与传入一致
    const all = filterBlockerCandidates({
      tasks: [],
      tracks,
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    expect(all.tracks.map((t) => t.id)).toEqual(["trA", "trB"]);
  });

  it("query 含特殊字符 ( [ 不崩且正常过滤", () => {
    const tasks = [task({ id: "1", title: "Alpha (test)" }), task({ id: "2", title: "Beta [test]" }), task({ id: "3", title: "Gamma" })];
    // 含 ( 的查询
    const r1 = filterBlockerCandidates({ tasks, tracks: [], selfTaskId: "self", existingBlockerKeys: new Set(), query: "(" });
    expect(r1.tasks.map((t) => t.id)).toEqual(["1"]);
    // 含 [ 的查询
    const r2 = filterBlockerCandidates({ tasks, tracks: [], selfTaskId: "self", existingBlockerKeys: new Set(), query: "[" });
    expect(r2.tasks.map((t) => t.id)).toEqual(["2"]);
    // 轨道同理
    const tracks = [track({ id: "tr1", title: "Alpha (x)" }), track({ id: "tr2", title: "Beta" })];
    const r3 = filterBlockerCandidates({ tasks: [], tracks, selfTaskId: "self", existingBlockerKeys: new Set(), query: "(" });
    expect(r3.tracks.map((t) => t.id)).toEqual(["tr1"]);
    expect(() => filterBlockerCandidates({ tasks, tracks, selfTaskId: "self", existingBlockerKeys: new Set(), query: "(" })).not.toThrow();
  });

  it("带日期的候选整体沉底，无日期的排在前面", () => {
    const tasks = [
      task({ id: "dated", scheduledAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" }),
      task({ id: "plain", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const result = filterBlockerCandidates({
      tasks,
      tracks: [],
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    // 按 updatedAt 倒序 dated 本该在前——沉底规则要压过它
    expect(result.tasks.map((t) => t.id)).toEqual(["plain", "dated"]);
  });

  it("重复发次的子步骤跟着父发次的排期一起沉底", () => {
    // 习惯子步骤自己 scheduledAt 恒为 null（materializeOccurrenceChildren），日期只挂在父发次上。
    // 不往上取一层，它们就是「无日期」，会把真正有用的候选挤到一屏之外。
    const occurrence = task({ id: "occ", ruleId: "r1", scheduledAt: "2026-08-20T00:00:00.000Z" });
    const child = task({ id: "child", parentId: "occ", updatedAt: "2026-08-20T00:00:00.000Z" });
    const plain = task({ id: "plain", updatedAt: "2026-06-01T00:00:00.000Z" });
    const result = filterBlockerCandidates({
      tasks: [occurrence, child, plain],
      tracks: [],
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    expect(result.tasks.map((t) => t.id)).toEqual(["plain", "child"]);
  });

  it("带日期的组内按日期倒序（近的在前），与 updatedAt 无关", () => {
    const tasks = [
      task({ id: "aug18", scheduledAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z" }),
      task({ id: "aug22", scheduledAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ];
    const result = filterBlockerCandidates({
      tasks,
      tracks: [],
      selfTaskId: "self",
      existingBlockerKeys: new Set(),
      query: "",
    });
    expect(result.tasks.map((t) => t.id)).toEqual(["aug22", "aug18"]);
  });

  it("existingBlockerKeys 含悬空 id 无影响", () => {
    const tasks = [task({ id: "a" }), task({ id: "b" })];
    const tracks = [track({ id: "tr1" }), track({ id: "tr2" })];
    const result = filterBlockerCandidates({
      tasks,
      tracks,
      selfTaskId: "self",
      existingBlockerKeys: new Set(["task:nonexistent", "track:ghost", "task:a"]),
      query: "",
    });
    // 悬空 id 不影响其他候选过滤，仅已存在的 a 被过滤
    expect(result.tasks.map((t) => t.id)).toEqual(["b"]);
    expect(result.tracks.map((t) => t.id)).toEqual(["tr1", "tr2"]);
    // 全部悬空时全量保留
    const all = filterBlockerCandidates({
      tasks,
      tracks,
      selfTaskId: "self",
      existingBlockerKeys: new Set(["task:ghost1", "track:ghost2"]),
      query: "",
    });
    expect(all.tasks.length).toBe(2);
    expect(all.tracks.length).toBe(2);
  });
});

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

describe("blockerCandidateContext", () => {
  it("项目名优先于父标题，日期照常缀在后面", () => {
    const scheduledAt = "2026-07-20T00:00:00.000Z";
    const t = task({ id: "t1", parentId: "p1", scheduledAt });
    const ctx = {
      projectNameByTaskId: new Map([["t1", "项目A"]]),
      taskById: new Map([["p1", task({ id: "p1", title: "父标题" })]]),
    };
    expect(blockerCandidateContext(t, ctx)).toBe(`项目A · ${dateLabel(scheduledAt)}`);
  });

  it("无项目有父 → 父标题", () => {
    const t = task({ id: "t1", parentId: "p1" });
    const ctx = {
      projectNameByTaskId: new Map<string, string>(),
      taskById: new Map([["p1", task({ id: "p1", title: "父任务标题" })]]),
    };
    expect(blockerCandidateContext(t, ctx)).toBe("父任务标题");
  });

  it("重复发次的子步骤 → 父标题 · 父发次的日期", () => {
    // 用户看到一屏「RQ签到 每日习惯【必做】」，条条同名、分不出是哪天的——日期得从父发次取。
    const scheduledAt = "2026-08-20T00:00:00.000Z";
    const occurrence = task({ id: "occ", title: "每日习惯【必做】", ruleId: "r1", scheduledAt });
    const child = task({ id: "c1", parentId: "occ", title: "RQ签到" });
    const ctx = {
      projectNameByTaskId: new Map<string, string>(),
      taskById: new Map([["occ", occurrence]]),
    };
    expect(blockerCandidateContext(child, ctx)).toBe(`每日习惯【必做】 · ${dateLabel(scheduledAt)}`);
  });

  it("无父有排期 → M月d日", () => {
    const scheduledAt = "2026-03-15T12:00:00.000Z";
    const t = task({ id: "t1", parentId: null, scheduledAt });
    const ctx = {
      projectNameByTaskId: new Map<string, string>(),
      taskById: new Map<string, Task>(),
    };
    const expected = dateLabel(scheduledAt);
    expect(blockerCandidateContext(t, ctx)).toBe(expected);
    // 具体值在 UTC 环境下为 "3月15日"
    // 为保证可复现，也硬断一次本地计算结果
    expect(expected).toMatch(/^\d+月\d+日$/);
  });

  it("三者皆无 → null", () => {
    const t = task({ id: "t1", parentId: null, scheduledAt: null });
    const ctx = {
      projectNameByTaskId: new Map<string, string>(),
      taskById: new Map<string, Task>(),
    };
    expect(blockerCandidateContext(t, ctx)).toBeNull();
  });

  it("有 parentId 但 taskById 缺失则回落到自己的 scheduledAt", () => {
    const scheduledAt = "2026-12-01T08:00:00.000Z";
    const t = task({ id: "t1", parentId: "p1", scheduledAt });
    const ctx = {
      projectNameByTaskId: new Map<string, string>(),
      taskById: new Map<string, Task>(),
    };
    expect(blockerCandidateContext(t, ctx)).toBe(dateLabel(scheduledAt));
  });

  it("非法 scheduledAt → null（不渲染 NaN月NaN日）", () => {
    const t = task({ id: "t1", parentId: null, scheduledAt: "not-a-date" });
    const ctx = {
      projectNameByTaskId: new Map<string, string>(),
      taskById: new Map<string, Task>(),
    };
    expect(blockerCandidateContext(t, ctx)).toBeNull();
  });

  it("父的 scheduledAt 非法时只显示父标题，不渲染 NaN月NaN日", () => {
    const occurrence = task({ id: "occ", title: "每日习惯【必做】", scheduledAt: "not-a-date" });
    const child = task({ id: "c1", parentId: "occ", title: "RQ签到" });
    const ctx = {
      projectNameByTaskId: new Map<string, string>(),
      taskById: new Map([["occ", occurrence]]),
    };
    expect(blockerCandidateContext(child, ctx)).toBe("每日习惯【必做】");
  });
});
