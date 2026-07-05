import type { Ref, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import {
  boardItemsForTracks,
  collectStatusFacetsFromItems,
  currentStepId,
  filterBoardItemsByStatusTags,
  formatStepDuration,
  groupStepsByTrack,
  isLinkRef,
  latestBoardSignal,
  latestStep,
  latestStepId,
  latestStepsForCard,
  orderedTimeline,
  partitionTracks,
  stepSourceText,
  trackProgressSummary,
} from "./tracksView.js";

const T = "2026-06-21T00:00:00.000Z";
const BOARD_SIGNALS = ["待我处理", "agent在做"];

function step(partial: Partial<TrackStep> & { id: string; seq: number }): TrackStep {
  return {
    trackId: "track-1",
    source: "agent",
    content: "",
    startedAt: T,
    endedAt: T,
    refs: [],
    tags: [],
    createdAt: T,
    updatedAt: T,
    ...partial,
  };
}

function track(id: string, status: "active" | "concluded" | "parked") {
  return { id, title: id, status, refs: [], createdAt: T, updatedAt: T };
}

describe("tracksView pure helpers", () => {
  it("groupStepsByTrack groups by trackId keeping semantic time ascending", () => {
    const grouped = groupStepsByTrack([
      step({ id: "backfill", seq: 9, trackId: "t1", startedAt: "2026-06-20T00:00:00.000Z" }),
      step({ id: "today", seq: 1, trackId: "t1", startedAt: "2026-06-21T00:00:00.000Z" }),
      step({ id: "c", seq: 0, trackId: "t2" }),
    ]);
    expect(grouped.get("t1")?.map((s) => s.id)).toEqual(["backfill", "today"]);
    expect(grouped.get("t2")?.map((s) => s.id)).toEqual(["c"]);
  });

  it("currentStepId picks the latest semantic-time open step, else null", () => {
    expect(
      currentStepId([
        step({ id: "a", seq: 0, endedAt: T }),
        step({ id: "b", seq: 9, endedAt: null, startedAt: "2026-06-21T00:00:00.000Z" }),
        step({ id: "c", seq: 2, endedAt: null, startedAt: "2026-06-22T00:00:00.000Z" }),
      ]),
    ).toBe("c");
    expect(currentStepId([step({ id: "a", seq: 9, endedAt: T })])).toBeNull();
  });

  it("currentStepId 与 shared latestOpenStep 同口径：同 seq 撞车取 startedAt/id 较大", () => {
    const a = step({ id: "a", seq: 1, startedAt: "2026-07-01T00:00:00.000Z", endedAt: null });
    const b = step({ id: "b", seq: 1, startedAt: "2026-07-01T01:00:00.000Z", endedAt: null });

    expect(currentStepId([a, b])).toBe("b");
  });

  it("latestStep picks the latest semantic-time step regardless of endedAt", () => {
    const steps = [
      step({ id: "backfill", seq: 9, endedAt: null, startedAt: "2026-06-21T01:00:00.000Z" }),
      step({ id: "today", seq: 2, endedAt: "2026-06-22T02:00:00.000Z", startedAt: "2026-06-22T02:00:00.000Z" }),
    ];
    expect(latestStepId(steps)).toBe("today");
    expect(latestStep(steps)?.id).toBe("today");
    expect(currentStepId(steps)).toBe("backfill");
  });

  it("latestBoardSignal is sticky and ignores later unconfigured tags", () => {
    const signal = latestBoardSignal(
      [
        step({ id: "agent", seq: 0, tags: ["agent在做"] }),
        step({ id: "note", seq: 1, tags: ["批注"] }),
        step({ id: "plain", seq: 2, tags: [] }),
      ],
      BOARD_SIGNALS,
    );
    expect(signal).toEqual({ tag: "agent在做", stepId: "agent" });
  });

  it("latestBoardSignal uses config order when one step has multiple signals", () => {
    const signal = latestBoardSignal([step({ id: "multi", seq: 0, tags: ["agent在做", "待我处理"] })], BOARD_SIGNALS);
    expect(signal).toEqual({ tag: "待我处理", stepId: "multi" });
  });

  it("latestBoardSignal ignores non-configured tags", () => {
    expect(latestBoardSignal([step({ id: "note", seq: 0, tags: ["批注"] })], BOARD_SIGNALS)).toBeNull();
  });

  it("boardItemsForTracks preserves track order and attaches sticky board signals", () => {
    const tracks = [track("agent", "active"), track("plain", "active"), track("mine", "active")];
    const steps = [
      step({ id: "agent-step", trackId: "agent", seq: 0, tags: ["agent在做"] }),
      step({ id: "mine-step", trackId: "mine", seq: 0, tags: ["待我处理"] }),
    ];
    expect(boardItemsForTracks(tracks, groupStepsByTrack(steps), BOARD_SIGNALS).map((item) => item.track.id)).toEqual([
      "agent",
      "plain",
      "mine",
    ]);
    expect(boardItemsForTracks(tracks, groupStepsByTrack(steps), BOARD_SIGNALS).map((item) => item.signal?.tag ?? null)).toEqual([
      "agent在做",
      null,
      "待我处理",
    ]);
  });

  it("collectStatusFacetsFromItems counts configured sticky board signals only", () => {
    const tracks = [track("a1", "active"), track("a2", "active"), track("a3", "active"), track("p1", "parked")];
    const steps = [
      step({ id: "a1-old", trackId: "a1", seq: 0, tags: ["agent在做"] }),
      step({ id: "a1-new", trackId: "a1", seq: 1, tags: [] }),
      step({ id: "a2-new", trackId: "a2", seq: 0, tags: ["待我处理", "批注"] }),
      step({ id: "a3-new", trackId: "a3", seq: 0, tags: ["决策"] }),
      step({ id: "p1-new", trackId: "p1", seq: 0, tags: ["待我处理"] }),
    ];
    const items = boardItemsForTracks(
      tracks.filter((item) => item.status === "active"),
      groupStepsByTrack(steps),
      BOARD_SIGNALS,
    );
    expect(collectStatusFacetsFromItems(items, BOARD_SIGNALS)).toEqual([
      { tag: "待我处理", count: 1, suggested: true },
      { tag: "agent在做", count: 1, suggested: true },
    ]);
  });

  it("filterBoardItemsByStatusTags uses OR against sticky board signals", () => {
    const tracks = [track("a1", "active"), track("a2", "active"), track("a3", "active"), track("c1", "concluded")];
    const steps = [
      step({ id: "a1-old", trackId: "a1", seq: 0, tags: ["agent在做"] }),
      step({ id: "a1-new", trackId: "a1", seq: 1, tags: [] }),
      step({ id: "a2", trackId: "a2", seq: 0, tags: ["待我处理"] }),
      step({ id: "a3", trackId: "a3", seq: 0, tags: ["复盘"] }),
      step({ id: "c1", trackId: "c1", seq: 0, tags: ["待我处理"] }),
    ];
    const items = boardItemsForTracks(
      tracks.filter((item) => item.status === "active"),
      groupStepsByTrack(steps),
      BOARD_SIGNALS,
    );
    expect(filterBoardItemsByStatusTags(items, []).map((item) => item.track.id)).toEqual(["a1", "a2", "a3"]);
    expect(filterBoardItemsByStatusTags(items, ["待我处理", "agent在做"]).map((item) => item.track.id)).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("latestStepsForCard returns the newest steps for compact cards", () => {
    expect(
      latestStepsForCard([
        step({ id: "a", seq: 0, startedAt: "2026-06-21T00:00:00.000Z" }),
        step({ id: "b", seq: 9, startedAt: "2026-06-20T00:00:00.000Z" }),
        step({ id: "c", seq: 2, startedAt: "2026-06-22T00:00:00.000Z" }),
        step({ id: "d", seq: 3, startedAt: "2026-06-23T00:00:00.000Z" }),
      ]).map((s) => s.id),
    ).toEqual(["d", "c", "a"]);
  });

  it("latestStepsForCard/orderedTimeline 按语义时间：昨天回填步不在顶部", () => {
    const backfill = step({
      id: "b",
      seq: 9,
      startedAt: "2026-07-01T00:00:00.000Z",
      endedAt: "2026-07-01T01:00:00.000Z",
    });
    const today = step({
      id: "t",
      seq: 3,
      startedAt: "2026-07-02T00:00:00.000Z",
      endedAt: "2026-07-02T01:00:00.000Z",
    });

    expect(latestStepsForCard([backfill, today])[0].id).toBe("t");
    expect(orderedTimeline([backfill, today])[0].id).toBe("t");
  });

  it("orderedTimeline sorts descending so the current step is on top", () => {
    const ordered = orderedTimeline([
      step({ id: "a", seq: 0 }),
      step({ id: "c", seq: 2, endedAt: null }),
      step({ id: "b", seq: 1 }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("orderedTimeline 把开口当前步钉在更大 seq 的即时点之上", () => {
    const ordered = orderedTimeline([
      step({ id: "done", seq: 0, endedAt: T }),
      step({ id: "current", seq: 1, endedAt: null }),
      step({ id: "note", seq: 2, endedAt: T, tags: ["批注"] }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["current", "note", "done"]);
  });

  it("partitionTracks splits active from concluded/parked, preserving order", () => {
    const { active, archived } = partitionTracks([
      track("a1", "active"),
      track("c1", "concluded"),
      track("p1", "parked"),
      track("a2", "active"),
    ]);
    expect(active.map((t) => t.id)).toEqual(["a1", "a2"]);
    expect(archived.map((t) => t.id)).toEqual(["c1", "p1"]);
  });

  it("formatStepDuration spans days and reuses minute formatting under a day", () => {
    const now = new Date("2026-06-25T00:00:00.000Z");
    expect(formatStepDuration("2026-06-21T00:00:00.000Z", null, now)).toBe("4天");
    expect(formatStepDuration("2026-06-21T00:00:00.000Z", "2026-06-22T03:00:00.000Z", now)).toBe("1天3小时");
    expect(formatStepDuration("2026-06-21T00:00:00.000Z", "2026-06-21T02:30:00.000Z", now)).toBe("2小时30分钟");
  });

  it("trackProgressSummary describes current open step, closed steps, or empty", () => {
    const now = new Date("2026-06-21T02:00:00.000Z");
    expect(
      trackProgressSummary(
        [step({ id: "a", seq: 0, endedAt: T }), step({ id: "b", seq: 1, startedAt: T, endedAt: null })],
        now,
      ),
    ).toBe("当前:第2步 · 已历时2小时");
    expect(trackProgressSummary([step({ id: "a", seq: 0, endedAt: T })], now)).toBe("共1步");
    expect(trackProgressSummary([], now)).toBe("尚无步骤");
  });

  it("trackProgressSummary 按开口步 seq 计数,不被后追加的即时点抬高", () => {
    const now = new Date("2026-06-21T02:00:00.000Z");
    expect(
      trackProgressSummary(
        [
          step({ id: "a", seq: 0, endedAt: T }),
          step({ id: "b", seq: 1, startedAt: T, endedAt: null }),
          step({ id: "note", seq: 2, endedAt: T, tags: ["批注"] }),
        ],
        now,
      ),
    ).toBe("当前:第2步 · 已历时2小时");
  });

  it("isLinkRef only treats http(s) ids as external links", () => {
    expect(isLinkRef({ kind: "url", id: "https://x.test" } as Ref)).toBe(true);
    expect(isLinkRef({ kind: "note", id: "http://x.test" } as Ref)).toBe(true);
    expect(isLinkRef({ kind: "task", id: "task-1" } as Ref)).toBe(false);
    expect(isLinkRef({ kind: "commit", id: "abc123" } as Ref)).toBe(false);
    expect(isLinkRef({ kind: "url", id: "javascript:alert(1)" } as Ref)).toBe(false);
    expect(isLinkRef({ kind: "url", id: "x.test" } as Ref)).toBe(false);
  });

  it("stepSourceText labels user as 我 and falls back to agent", () => {
    expect(stepSourceText(step({ id: "a", seq: 0, source: "user" }))).toBe("我");
    expect(stepSourceText(step({ id: "b", seq: 0, source: "agent", sourceLabel: "codex" }))).toBe("codex");
    expect(stepSourceText(step({ id: "c", seq: 0, source: "agent" }))).toBe("agent");
  });
});
