import { describe, expect, it } from "vitest";
import type { Track, TrackStep } from "@timedata/shared";
import { badgeToneForSignal } from "./trackBadgeTone.js";
import { buildTaskTrackIndex, findActiveTrackForTask } from "./taskTrackIndex.js";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "trk-1",
    title: "轨道一",
    status: "active",
    refs: [{ kind: "task", id: "task-1", label: "任务一" }],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeStep(overrides: Partial<TrackStep> = {}): TrackStep {
  return {
    id: "step-1",
    trackId: "trk-1",
    source: "agent",
    content: "跑完一轮",
    startedAt: "2026-08-02T00:00:00.000Z",
    endedAt: "2026-08-02T00:10:00.000Z",
    refs: [],
    tags: [],
    seq: 0,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

// ACTION 刻意**不含** EXEC 的词：两者若有包含关系，`[...actionTags, ...agentExecTags]` 的第二段
// 就零贡献，"词表是两者拼接"这条断言会退化成恒绿（少写一个 spread 也测不出来）。
const ACTION = ["待我处理"];
const EXEC = ["agent在做"];

describe("badgeToneForSignal", () => {
  it("无信号 → default", () => {
    expect(badgeToneForSignal(null, ACTION, EXEC)).toBe("default");
  });
  it("actionTags[0]（待我处理）→ warn，优先于 agent 判定（与调度台 classify 同序）", () => {
    expect(badgeToneForSignal({ tag: "待我处理" }, ["待我处理"], ["待我处理"])).toBe("warn");
  });
  it("命中 agentExecTags → agent", () => {
    expect(badgeToneForSignal({ tag: "agent在做" }, ACTION, EXEC)).toBe("agent");
  });
  it("普通信号 → default", () => {
    expect(badgeToneForSignal({ tag: "卡住" }, ACTION, EXEC)).toBe("default");
  });
});

describe("findActiveTrackForTask", () => {
  it("refs kind=task 命中且 active → 返回该轨道", () => {
    expect(findActiveTrackForTask([makeTrack()], "task-1")?.id).toBe("trk-1");
  });
  it("concluded 轨道不算挂载", () => {
    expect(findActiveTrackForTask([makeTrack({ status: "concluded" })], "task-1")).toBeNull();
  });
  it("多条命中取 updatedAt 最新", () => {
    const older = makeTrack();
    const newer = makeTrack({ id: "trk-2", updatedAt: "2026-08-03T00:00:00.000Z" });
    expect(findActiveTrackForTask([older, newer], "task-1")?.id).toBe("trk-2");
  });
  it("kind 非 task 的 ref 不算", () => {
    const t = makeTrack({ refs: [{ kind: "goal", id: "task-1" }] });
    expect(findActiveTrackForTask([t], "task-1")).toBeNull();
  });
});

describe("buildTaskTrackIndex", () => {
  it("挂载任务拿到 track + 信号 + tone；词表 = actionTags 与 agentExecTags 拼接（与调度台同口径）", () => {
    const steps = new Map([["trk-1", [makeStep({ tags: ["agent在做"] })]]]);
    const index = buildTaskTrackIndex([makeTrack()], steps, ACTION, EXEC);
    const info = index.get("task-1");
    expect(info?.track.id).toBe("trk-1");
    expect(info?.signal?.tag).toBe("agent在做");
    expect(info?.tone).toBe("agent");
  });
  it("无步轨道信号为 null、tone default", () => {
    const index = buildTaskTrackIndex([makeTrack()], new Map(), ACTION, EXEC);
    expect(index.get("task-1")).toMatchObject({ signal: null, tone: "default" });
  });
  it("后续无标签步不清除已有信号（口径 = latestTrackBoardSignal）", () => {
    const steps = new Map([
      ["trk-1", [makeStep({ id: "s1", tags: ["待我处理"], seq: 0 }), makeStep({ id: "s2", seq: 1, startedAt: "2026-08-02T01:00:00.000Z" })]],
    ]);
    const index = buildTaskTrackIndex([makeTrack()], steps, ACTION, EXEC);
    expect(index.get("task-1")?.signal?.tag).toBe("待我处理");
    expect(index.get("task-1")?.tone).toBe("warn");
  });
  it("非 active 轨道不入索引", () => {
    const index = buildTaskTrackIndex([makeTrack({ status: "concluded" })], new Map(), ACTION, EXEC);
    expect(index.size).toBe(0);
  });
  // 本函数的仲裁是 findActiveTrackForTask 的第二份实现（两者互不调用），故平局规则要各钉各的：
  // 只钉一边时，把这边降级成「数组里最后一条赢」不会红，抽屉链接与行徽章会指向两条不同轨道。
  it("同任务多条 active 轨道取 updatedAt 最新（与 findActiveTrackForTask 同口径）", () => {
    const newer = makeTrack({ id: "trk-2", updatedAt: "2026-08-03T00:00:00.000Z" });
    const older = makeTrack({ id: "trk-1", updatedAt: "2026-08-01T00:00:00.000Z" });
    // 顺序刻意让"最新"排在前面：若实现退化成无条件覆盖，赢的会是数组末尾的 older。
    const index = buildTaskTrackIndex([newer, older], new Map(), ACTION, EXEC);
    expect(index.get("task-1")?.track.id).toBe("trk-2");
  });
});
