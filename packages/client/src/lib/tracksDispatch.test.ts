import type { Track, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import {
  dispatchItems,
  dispatchStats,
  groupDispatchItems,
  STALL_THRESHOLD_MS,
} from "./tracksDispatch.js";

const NOW = new Date("2026-07-09T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

function makeTrack(id: string, createdAgo = 30 * DAY): Track {
  return { id, title: `轨道${id}`, status: "active", refs: [], createdAt: iso(createdAgo), updatedAt: iso(0) };
}

let seq = 0;
function makeStep(trackId: string, endedAgo: number, tags: string[] = []): TrackStep {
  seq += 1;
  return {
    id: `s${seq}`,
    trackId,
    source: "user",
    content: `步骤${seq}`,
    startedAt: iso(endedAgo + 3_600_000),
    endedAt: iso(endedAgo),
    refs: [],
    tags,
    seq,
    createdAt: iso(endedAgo),
    updatedAt: iso(endedAgo),
  };
}

const ACTION = ["待我处理", "需决策"];
const EXEC = ["agent在做"];

function itemsOf(entries: [Track, TrackStep[]][]) {
  return dispatchItems(
    entries.map(([t]) => t),
    new Map(entries.map(([t, s]) => [t.id, s])),
    ACTION,
    EXEC,
    NOW,
  );
}

describe("dispatchItems 分组判定", () => {
  it("最新信号=待我处理 → 等我接；停滞不豁免且标停滞天数", () => {
    const fresh = itemsOf([[makeTrack("a"), [makeStep("a", 3_600_000, ["待我处理"])]]])[0];
    expect(fresh.group).toBe("awaiting-me");
    expect(fresh.stalledDays).toBeNull();
    const old = itemsOf([[makeTrack("b"), [makeStep("b", 13 * DAY, ["待我处理"])]]])[0];
    expect(old.group).toBe("awaiting-me");
    expect(old.stalledDays).toBe(13);
  });

  it("agent 信号且未停滞 → agent在跑；挂超 7 天 → 停滞", () => {
    const running = itemsOf([[makeTrack("a"), [makeStep("a", DAY, ["agent在做"])]]])[0];
    expect(running.group).toBe("agent-running");
    const dead = itemsOf([[makeTrack("b"), [makeStep("b", 13 * DAY, ["agent在做"])]]])[0];
    expect(dead.group).toBe("stalled");
    expect(dead.stalledDays).toBe(13);
  });

  it("信号口径=最近带信号的步：中途补无信号步不清除信号", () => {
    const item = itemsOf([
      [makeTrack("a"), [makeStep("a", 2 * DAY, ["待我处理"]), makeStep("a", DAY, [])]],
    ])[0];
    expect(item.signal?.tag).toBe("待我处理");
    expect(item.group).toBe("awaiting-me");
  });

  it("非首位看板信号（如 需决策）不进等我接，进推进中但保留徽章", () => {
    const item = itemsOf([[makeTrack("a"), [makeStep("a", DAY, ["需决策"])]]])[0];
    expect(item.group).toBe("in-progress");
    expect(item.signal?.tag).toBe("需决策");
  });

  it("无信号新鲜 → 推进中；无步轨道按 createdAt 兜底判停滞", () => {
    expect(itemsOf([[makeTrack("a"), [makeStep("a", DAY)]]])[0].group).toBe("in-progress");
    expect(itemsOf([[makeTrack("b", 2 * DAY), []]])[0].group).toBe("in-progress");
    const staleEmpty = itemsOf([[makeTrack("c", 10 * DAY), []]])[0];
    expect(staleEmpty.group).toBe("stalled");
    expect(staleEmpty.lastActivityAt).toBeNull();
  });

  it("阈值边界：恰好 7 天不算停滞，超过才算", () => {
    expect(itemsOf([[makeTrack("a"), [makeStep("a", STALL_THRESHOLD_MS)]]])[0].group).toBe("in-progress");
    expect(itemsOf([[makeTrack("b"), [makeStep("b", STALL_THRESHOLD_MS + DAY)]]])[0].group).toBe("stalled");
  });
});

describe("groupDispatchItems / dispatchStats", () => {
  it("固定显示序、空组剔除、组内最后动静倒序", () => {
    const items = itemsOf([
      [makeTrack("stale"), [makeStep("stale", 9 * DAY)]],
      [makeTrack("waitOld"), [makeStep("waitOld", 2 * DAY, ["待我处理"])]],
      [makeTrack("waitNew"), [makeStep("waitNew", DAY, ["待我处理"])]],
      [makeTrack("run"), [makeStep("run", DAY, ["agent在做"])]],
    ]);
    const groups = groupDispatchItems(items);
    expect(groups.map((g) => g.key)).toEqual(["awaiting-me", "agent-running", "stalled"]);
    expect(groups[0].items.map((i) => i.track.id)).toEqual(["waitNew", "waitOld"]);
    expect(groups[0].label).toBe("等我接");
  });

  it("统计带三数", () => {
    const items = itemsOf([
      [makeTrack("a"), [makeStep("a", DAY, ["待我处理"])]],
      [makeTrack("b"), [makeStep("b", DAY, ["agent在做"])]],
      [makeTrack("c"), [makeStep("c", 9 * DAY)]],
      [makeTrack("d"), [makeStep("d", DAY)]],
    ]);
    expect(dispatchStats(items)).toEqual({ awaiting: 1, agentRunning: 1, stalled: 1 });
  });
});
