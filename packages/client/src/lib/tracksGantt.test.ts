import type { Track, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import {
  AFTERGLOW_MS,
  autoFitWindow,
  axisTicks,
  clampWindow,
  concurrencyStats,
  earliestSegmentDayMs,
  GANTT_MAX_SPAN_MS,
  GANTT_MIN_SPAN_MS,
  ganttLanes,
  laneNowStatus,
  panWindow,
  presetWindow,
  RUNNING_MIN_PX,
  segmentShape,
  startOfLocalDay,
  timeToX,
  visibleSegments,
  xToMs,
  zoomWindow,
} from "./tracksGantt.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
// 固定"此刻"：2026-07-08T12:00 本地。用本地构造避免时区断言漂移。
const NOW = new Date(2026, 6, 8, 12, 0, 0).getTime();
const MIN_START = startOfLocalDay(NOW - 30 * DAY);

describe("clampWindow", () => {
  it("右缘不越过此刻", () => {
    const w = clampWindow({ startMs: NOW - HOUR, endMs: NOW + HOUR }, NOW, MIN_START);
    expect(w.endMs).toBe(NOW);
    expect(w.endMs - w.startMs).toBe(2 * HOUR);
  });
  it("跨度夹在 [1h, 7d]", () => {
    const tiny = clampWindow({ startMs: NOW - 1000, endMs: NOW }, NOW, MIN_START);
    expect(tiny.endMs - tiny.startMs).toBe(GANTT_MIN_SPAN_MS);
    const huge = clampWindow({ startMs: NOW - 30 * DAY, endMs: NOW }, NOW, MIN_START);
    expect(huge.endMs - huge.startMs).toBe(GANTT_MAX_SPAN_MS);
  });
  it("左缘不越过 minStartMs（窗口整体右移）", () => {
    const w = clampWindow({ startMs: MIN_START - DAY, endMs: MIN_START + HOUR }, NOW, MIN_START);
    expect(w.startMs).toBe(MIN_START);
    expect(w.endMs - w.startMs).toBe(DAY + HOUR);
  });
});

describe("zoomWindow", () => {
  it("锚点时间是缩放不动点", () => {
    const w = { startMs: NOW - 4 * HOUR, endMs: NOW - 2 * HOUR };
    const anchorRatio = 0.25;
    const anchorT = w.startMs + anchorRatio * (w.endMs - w.startMs);
    const zoomed = zoomWindow(w, anchorRatio, 0.5, NOW, MIN_START);
    const anchorAfter = zoomed.startMs + anchorRatio * (zoomed.endMs - zoomed.startMs);
    expect(Math.abs(anchorAfter - anchorT)).toBeLessThan(1);
    expect(zoomed.endMs - zoomed.startMs).toBe(HOUR);
  });
  it("放大到底 clamp 到 1h", () => {
    const w = { startMs: NOW - HOUR, endMs: NOW };
    const zoomed = zoomWindow(w, 0.5, 0.01, NOW, MIN_START);
    expect(zoomed.endMs - zoomed.startMs).toBe(GANTT_MIN_SPAN_MS);
  });
});

describe("panWindow", () => {
  it("向右平移被此刻挡住", () => {
    const w = { startMs: NOW - 2 * HOUR, endMs: NOW - HOUR };
    const panned = panWindow(w, 5 * HOUR, NOW, MIN_START);
    expect(panned.endMs).toBe(NOW);
  });
  it("向左平移被 minStartMs 挡住", () => {
    const w = { startMs: MIN_START + HOUR, endMs: MIN_START + 3 * HOUR };
    const panned = panWindow(w, -5 * HOUR, NOW, MIN_START);
    expect(panned.startMs).toBe(MIN_START);
  });
});

describe("presetWindow", () => {
  it("today = 本地零点到此刻", () => {
    const w = presetWindow("today", NOW);
    expect(w.startMs).toBe(startOfLocalDay(NOW));
    expect(w.endMs).toBe(NOW);
  });
  it("凌晨的 today 保底 1h 回溯", () => {
    const earlyNow = startOfLocalDay(NOW) + 10 * 60_000; // 00:10
    const w = presetWindow("today", earlyNow);
    expect(earlyNow - w.startMs).toBe(GANTT_MIN_SPAN_MS);
  });
  it("3d / 7d 右缘=此刻", () => {
    expect(presetWindow("3d", NOW)).toEqual({ startMs: NOW - 3 * DAY, endMs: NOW });
    expect(presetWindow("7d", NOW)).toEqual({ startMs: NOW - 7 * DAY, endMs: NOW });
  });
});

describe("timeToX / xToMs 互逆", () => {
  it("往返一致", () => {
    const w = { startMs: NOW - DAY, endMs: NOW };
    expect(timeToX(w, 800, NOW)).toBe(800);
    expect(timeToX(w, 800, NOW - DAY)).toBe(0);
    expect(Math.abs(xToMs(w, 800, timeToX(w, 800, NOW - 5 * HOUR)) - (NOW - 5 * HOUR))).toBeLessThan(1);
  });
});

describe("axisTicks", () => {
  it("6h 窗口出小时刻度，标签 HH:00", () => {
    const w = { startMs: NOW - 6 * HOUR, endMs: NOW };
    const ticks = axisTicks(w);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(9);
    expect(ticks.every((t) => t.tMs >= w.startMs && t.tMs <= w.endMs)).toBe(true);
    expect(ticks.some((t) => /^\d{2}:00$/.test(t.label))).toBe(true);
  });
  it("7d 窗口出天刻度，标签 M/D", () => {
    const w = { startMs: NOW - 7 * DAY, endMs: NOW };
    const ticks = axisTicks(w);
    expect(ticks.every((t) => /^\d{1,2}\/\d{1,2}$/.test(t.label))).toBe(true);
  });
  it("跨午夜的小时刻度里零点显示日期", () => {
    const w = { startMs: startOfLocalDay(NOW) - 3 * HOUR, endMs: startOfLocalDay(NOW) + 3 * HOUR };
    const ticks = axisTicks(w);
    const midnight = ticks.find((t) => t.tMs === startOfLocalDay(NOW));
    expect(midnight?.label).toMatch(/^\d{1,2}\/\d{1,2}$/);
  });
});

describe("常量", () => {
  it("余晖 2 小时", () => {
    expect(AFTERGLOW_MS).toBe(2 * HOUR);
  });
});

const iso = (ms: number) => new Date(ms).toISOString();

function makeTrack(id: string, partial: Partial<Track> = {}): Track {
  return { id, title: id, status: "active", refs: [], createdAt: iso(NOW - 10 * DAY), updatedAt: iso(NOW), ...partial };
}

let seqCounter = 0;
function makeStep(
  trackId: string,
  startMs: number,
  endMs: number | null,
  source: "user" | "agent" = "user",
): TrackStep {
  seqCounter += 1;
  return {
    id: `s${seqCounter}`,
    trackId,
    source,
    content: "",
    startedAt: iso(startMs),
    endedAt: endMs === null ? null : iso(endMs),
    refs: [],
    tags: [],
    seq: seqCounter,
    createdAt: iso(startMs),
    updatedAt: iso(startMs),
  };
}

function lanesOf(entries: Array<[Track, TrackStep[]]>, agentExecTags: readonly string[] = ["agent在做"]) {
  const tracks = entries.map(([t]) => t);
  const byTrack = new Map(entries.map(([t, s]) => [t.id, s] as const));
  return ganttLanes(tracks, byTrack, NOW, agentExecTags, ["待我处理"]);
}

describe("ganttLanes", () => {
  it("闭合步=bar、瞬时步=point、开口步=running 延伸到此刻", () => {
    const t = makeTrack("a");
    const [lane] = lanesOf([
      [
        t,
        [
          makeStep("a", NOW - 5 * HOUR, NOW - 4 * HOUR),
          makeStep("a", NOW - 3 * HOUR, NOW - 3 * HOUR),
          makeStep("a", NOW - HOUR, null),
        ],
      ],
    ]);
    expect(lane.segments.map((s) => s.kind)).toEqual(["bar", "point", "running"]);
    expect(lane.segments[2].endMs).toBe(NOW);
  });
  it("开口步的新鲜/陈旧：2h 内 staleSinceMs=null，超 2h = start+2h", () => {
    const t = makeTrack("a");
    const [lane] = lanesOf([[t, [makeStep("a", NOW - HOUR, null)]]]);
    expect(lane.segments[0].staleSinceMs).toBeNull();
    const [zombie] = lanesOf([[t, [makeStep("a", NOW - 12 * DAY, null)]]]);
    expect(zombie.segments[0].staleSinceMs).toBe(NOW - 12 * DAY + AFTERGLOW_MS);
  });
  it("执行者着色：配置的 agent 执行信号优先，回退写入者", () => {
    const t = makeTrack("a");
    const delegated = { ...makeStep("a", NOW - 4 * HOUR, NOW - 3 * HOUR, "user"), tags: ["agent在做"] };
    const mine = makeStep("a", NOW - 2 * HOUR, NOW - HOUR, "user");
    const agentWritten = makeStep("a", NOW - HOUR, null, "agent");
    const [lane] = lanesOf([[t, [delegated, mine, agentWritten]]]);
    expect(lane.segments.map((s) => s.source)).toEqual(["agent", "user", "agent"]);
    // 换配置：改名信号后按新配置判；空配置只看写入者
    const [renamed] = lanesOf([[t, [delegated]]], ["机器人在做"]);
    expect(renamed.segments[0].source).toBe("user");
    const [plain] = lanesOf([[t, [delegated]]], []);
    expect(plain.segments[0].source).toBe("user");
  });

  it("未来开口步（时钟漂移）退化为点", () => {
    const t = makeTrack("a");
    const [lane] = lanesOf([[t, [makeStep("a", NOW + HOUR, null)]]]);
    expect(lane.segments[0].kind).toBe("point");
  });
  it("排序：最后活动降序，空轨道垫底按创建降序", () => {
    const hot = makeTrack("hot");
    const cold = makeTrack("cold");
    const emptyNew = makeTrack("empty-new", { createdAt: iso(NOW - DAY) });
    const emptyOld = makeTrack("empty-old", { createdAt: iso(NOW - 5 * DAY) });
    const lanes = lanesOf([
      [emptyOld, []],
      [cold, [makeStep("cold", NOW - 2 * DAY, NOW - 2 * DAY + HOUR)]],
      [emptyNew, []],
      [hot, [makeStep("hot", NOW - HOUR, null)]],
    ]);
    expect(lanes.map((l) => l.track.id)).toEqual(["hot", "cold", "empty-new", "empty-old"]);
  });
  it("排序沿用 lastActivityAt 语义：开口步按开始时间", () => {
    const openOld = makeTrack("open-old");
    const closedNew = makeTrack("closed-new");
    const lanes = lanesOf([
      [openOld, [makeStep("open-old", NOW - 2 * DAY, null)]],
      [closedNew, [makeStep("closed-new", NOW - HOUR, NOW - HOUR + 600_000)]],
    ]);
    expect(lanes.map((l) => l.track.id)).toEqual(["closed-new", "open-old"]);
  });
});

describe("余晖", () => {
  it("最新一步刚收尾 → 余晖到 min(收尾+2h, 此刻)", () => {
    const t = makeTrack("a");
    const [lane] = lanesOf([[t, [makeStep("a", NOW - 3 * HOUR, NOW - HOUR)]]]);
    expect(lane.afterglow).toEqual({ startMs: NOW - HOUR, endMs: NOW });
  });
  it("有 running 步不画余晖", () => {
    const t = makeTrack("a");
    const [lane] = lanesOf([
      [t, [makeStep("a", NOW - 3 * HOUR, NOW - HOUR), makeStep("a", NOW - 0.5 * HOUR, null)]],
    ]);
    expect(lane.afterglow).toBeNull();
  });
  it("收尾超过 2h 不画余晖", () => {
    const t = makeTrack("a");
    const [lane] = lanesOf([[t, [makeStep("a", NOW - 5 * HOUR, NOW - 3 * HOUR)]]]);
    expect(lane.afterglow).toBeNull();
  });
  it("无步无余晖", () => {
    const [lane] = lanesOf([[makeTrack("a"), []]]);
    expect(lane.afterglow).toBeNull();
  });
});

describe("visibleSegments", () => {
  it("只留与窗口相交的段", () => {
    const t = makeTrack("a");
    const [lane] = lanesOf([
      [t, [makeStep("a", NOW - 10 * HOUR, NOW - 9 * HOUR), makeStep("a", NOW - 2 * HOUR, NOW - HOUR)]],
    ]);
    const w = { startMs: NOW - 3 * HOUR, endMs: NOW };
    expect(visibleSegments(lane.segments, w)).toHaveLength(1);
  });
});

describe("autoFitWindow / earliestSegmentDayMs", () => {
  it("无任何步 → 退最近 24h", () => {
    const w = autoFitWindow(lanesOf([[makeTrack("a"), []]]), NOW);
    expect(w).toEqual({ startMs: NOW - 24 * HOUR, endMs: NOW });
  });
  it("全员不活跃（只剩僵尸开口步/超旧步）→ 退最近 24h，不被拉爆到一周", () => {
    const lanes = lanesOf([
      [makeTrack("zombie"), [makeStep("zombie", NOW - 6 * DAY, null)]],
      [makeTrack("old"), [makeStep("old", NOW - 5 * DAY, NOW - 5 * DAY + HOUR)]],
    ]);
    const w = autoFitWindow(lanes, NOW);
    expect(w.startMs).toBe(NOW - 24 * HOUR);
  });
  it("僵尸泳道不参与取景，最近活跃的泳道决定左缘", () => {
    const lanes = lanesOf([
      [makeTrack("zombie"), [makeStep("zombie", NOW - 6 * DAY, null)]],
      [makeTrack("fresh"), [makeStep("fresh", NOW - 3 * HOUR, NOW - 2 * HOUR)]],
    ]);
    const w = autoFitWindow(lanes, NOW);
    // 左缘由 fresh 决定（含 6h 下限），远小于 6 天
    expect(NOW - w.startMs).toBeLessThanOrEqual(6 * HOUR);
  });
  it("覆盖各泳道最新一步的开始，取整到小时，此刻在窗口内且非右缘", () => {
    const a = makeTrack("a");
    const b = makeTrack("b");
    const lanes = lanesOf([
      [a, [makeStep("a", NOW - 30 * HOUR, NOW - 29 * HOUR)]],
      [b, [makeStep("b", NOW - 2 * HOUR, null)]],
    ]);
    const w = autoFitWindow(lanes, NOW);
    expect(w.endMs).toBe(NOW);
    expect(w.startMs).toBeLessThanOrEqual(NOW - 30 * HOUR);
    expect(Math.floor(w.startMs / HOUR) * HOUR).toBe(w.startMs);
  });
  it("最近活跃但跨度超长（30天长条刚收尾）回溯被 7d 上限截断", () => {
    const a = makeTrack("a");
    const lanes = lanesOf([[a, [makeStep("a", NOW - 30 * DAY, NOW - HOUR)]]]);
    const w = autoFitWindow(lanes, NOW);
    expect(NOW - w.startMs).toBe(GANTT_MAX_SPAN_MS);
  });
  it("earliestSegmentDayMs = 最早步的本地零点；无步取此刻零点", () => {
    const a = makeTrack("a");
    const lanes = lanesOf([[a, [makeStep("a", NOW - 30 * DAY, NOW - 30 * DAY + HOUR)]]]);
    expect(earliestSegmentDayMs(lanes, NOW)).toBe(startOfLocalDay(NOW - 30 * DAY));
    expect(earliestSegmentDayMs(lanesOf([[makeTrack("b"), []]]), NOW)).toBe(startOfLocalDay(NOW));
  });
});

describe("concurrencyStats", () => {
  it("running=有开口步的泳道数, active24h=24h 内有动静的泳道数", () => {
    const lanes = lanesOf([
      [makeTrack("r"), [makeStep("r", NOW - HOUR, null)]],
      [makeTrack("recent"), [makeStep("recent", NOW - 3 * HOUR, NOW - 2 * HOUR)]],
      [makeTrack("stale"), [makeStep("stale", NOW - 3 * DAY, NOW - 3 * DAY + HOUR)]],
      [makeTrack("empty"), []],
    ]);
    expect(concurrencyStats(lanes, NOW)).toEqual({ running: 1, active24h: 2 });
  });
  it("陈旧开口步（12天前开着没闭合）算 running 但不算 24h 活跃", () => {
    const lanes = lanesOf([[makeTrack("zombie"), [makeStep("zombie", NOW - 12 * DAY, null)]]]);
    expect(concurrencyStats(lanes, NOW)).toEqual({ running: 1, active24h: 0 });
  });
});

describe("等待段", () => {
  it("带等待信号的步 waiting=true（开口/闭合都算），普通步不算", () => {
    const t = makeTrack("a");
    const handoff = { ...makeStep("a", NOW - 3 * HOUR, NOW - HOUR), tags: ["待我处理"] };
    const openWait = { ...makeStep("a", NOW - HOUR, null), tags: ["待我处理"] };
    const work = makeStep("a", NOW - 5 * HOUR, NOW - 4 * HOUR);
    const [lane] = lanesOf([[t, [work, handoff, openWait]]]);
    expect(lane.segments.map((s) => s.waiting)).toEqual([false, true, true]);
  });
});

describe("laneNowStatus", () => {
  it("等待中的开口步 → waiting（优先于陈旧判定），sinceMs=开步时刻", () => {
    const openWait = { ...makeStep("a", NOW - 5 * HOUR, null), tags: ["待我处理"] };
    const [lane] = lanesOf([[makeTrack("a"), [openWait]]]);
    expect(laneNowStatus(lane, NOW)).toEqual({ kind: "waiting", sinceMs: NOW - 5 * HOUR });
  });
  it.each([
    ["新鲜开口步 → running", [makeStep("a", NOW - HOUR, null)], "running"],
    ["陈旧开口步 → stale-open", [makeStep("a", NOW - 3 * DAY, null)], "stale-open"],
    ["刚收尾 → recent", [makeStep("a", NOW - 3 * HOUR, NOW - HOUR)], "recent"],
    ["收尾很久 → idle", [makeStep("a", NOW - 3 * DAY, NOW - 3 * DAY + HOUR)], "idle"],
    ["无步 → idle", [], "idle"],
  ] as const)("%s", (_label, steps, expected) => {
    const [lane] = lanesOf([[makeTrack("a"), [...steps]]]);
    expect(laneNowStatus(lane, NOW).kind).toBe(expected);
  });
  it("idle 的 sinceMs=最后动静；无步为 null", () => {
    const [lane] = lanesOf([[makeTrack("a"), [makeStep("a", NOW - 3 * DAY, NOW - 3 * DAY + HOUR)]]]);
    expect(laneNowStatus(lane, NOW)).toEqual({ kind: "idle", sinceMs: NOW - 3 * DAY + HOUR });
    const [empty] = lanesOf([[makeTrack("b"), []]]);
    expect(laneNowStatus(empty, NOW)).toEqual({ kind: "idle", sinceMs: null });
  });
});

describe("segmentShape", () => {
  const w = { startMs: NOW - 10 * HOUR, endMs: NOW };
  it("长条出 rect", () => {
    const seg = {
      kind: "bar" as const,
      startMs: NOW - 5 * HOUR,
      endMs: NOW - 2 * HOUR,
      stepId: "s",
      source: "user" as const,
    };
    expect(segmentShape(seg, w, 1000)).toMatchObject({ shape: "rect" });
  });
  it("瞬时/过窄退化为 dot", () => {
    const point = {
      kind: "point" as const,
      startMs: NOW - HOUR,
      endMs: NOW - HOUR,
      stepId: "s",
      source: "user" as const,
    };
    expect(segmentShape(point, w, 1000).shape).toBe("dot");
    const sliver = {
      kind: "bar" as const,
      startMs: NOW - HOUR,
      endMs: NOW - HOUR + 60_000,
      stepId: "s",
      source: "user" as const,
    };
    expect(segmentShape(sliver, w, 100).shape).toBe("dot");
  });
  it("running 段吃最小宽度保底，右缘锚定在 endMs 投影", () => {
    const seg = {
      kind: "running" as const,
      startMs: NOW - 60_000,
      endMs: NOW,
      stepId: "s",
      source: "user" as const,
    };
    const shape = segmentShape(seg, w, 1000);
    expect(shape.shape).toBe("rect");
    if (shape.shape !== "rect") throw new Error("unreachable");
    expect(shape.width).toBe(RUNNING_MIN_PX);
    expect(shape.x + shape.width).toBeCloseTo(timeToX(w, 1000, NOW), 5);
  });
  it("running 保底条贴窗口左缘时 x clamp 到 0 不越界", () => {
    const seg = {
      kind: "running" as const,
      startMs: w.startMs,
      endMs: w.startMs + 60_000,
      stepId: "s",
      source: "user" as const,
    };
    const shape = segmentShape(seg, w, 1000);
    expect(shape.shape).toBe("rect");
    if (shape.shape !== "rect") throw new Error("unreachable");
    expect(shape.x).toBe(0);
    expect(shape.width).toBe(RUNNING_MIN_PX);
  });
  it("足够宽的 running 段宽度按真实投影，不被保底覆盖", () => {
    const seg = {
      kind: "running" as const,
      startMs: NOW - 5 * HOUR,
      endMs: NOW,
      stepId: "s",
      source: "user" as const,
    };
    const shape = segmentShape(seg, w, 1000);
    expect(shape.shape).toBe("rect");
    if (shape.shape !== "rect") throw new Error("unreachable");
    expect(shape.width).toBeCloseTo(500, 5); // 5h / 10h 窗口 × 1000px
    expect(shape.x).toBeCloseTo(500, 5);
  });
});
