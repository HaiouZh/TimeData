import type { Ref, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import {
  currentStepId,
  formatStepDuration,
  groupStepsByTrack,
  isDecisionStep,
  isLinkRef,
  orderedTimeline,
  partitionTracks,
  trackProgressSummary,
} from "./tracksView.js";

const T = "2026-06-21T00:00:00.000Z";

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
  it("groupStepsByTrack groups by trackId keeping seq ascending", () => {
    const grouped = groupStepsByTrack([
      step({ id: "b", seq: 1, trackId: "t1" }),
      step({ id: "a", seq: 0, trackId: "t1" }),
      step({ id: "c", seq: 0, trackId: "t2" }),
    ]);
    expect(grouped.get("t1")?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(grouped.get("t2")?.map((s) => s.id)).toEqual(["c"]);
  });

  it("currentStepId picks the open step with the largest seq, else null", () => {
    expect(
      currentStepId([
        step({ id: "a", seq: 0, endedAt: T }),
        step({ id: "b", seq: 1, endedAt: null }),
        step({ id: "c", seq: 2, endedAt: null }),
      ]),
    ).toBe("c");
    // 全闭合(concluded)→ 无 current,不退回最新历史步
    expect(currentStepId([step({ id: "a", seq: 9, endedAt: T })])).toBeNull();
  });

  it("orderedTimeline sorts descending so the current step is on top", () => {
    const ordered = orderedTimeline([
      step({ id: "a", seq: 0 }),
      step({ id: "c", seq: 2, endedAt: null }),
      step({ id: "b", seq: 1 }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["c", "b", "a"]);
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

  it("trackProgressSummary describes current open step, concluded, or empty", () => {
    const now = new Date("2026-06-21T02:00:00.000Z");
    expect(
      trackProgressSummary(
        [step({ id: "a", seq: 0, endedAt: T }), step({ id: "b", seq: 1, startedAt: T, endedAt: null })],
        now,
      ),
    ).toBe("当前:第2步 · 已历时2小时");
    expect(trackProgressSummary([step({ id: "a", seq: 0, endedAt: T })], now)).toBe("共1步 · 已收束");
    expect(trackProgressSummary([], now)).toBe("尚无步骤");
  });

  it("isDecisionStep matches the 决策/decision tags only", () => {
    expect(isDecisionStep(step({ id: "a", seq: 0, tags: ["决策"] }))).toBe(true);
    expect(isDecisionStep(step({ id: "b", seq: 0, tags: ["decision"] }))).toBe(true);
    expect(isDecisionStep(step({ id: "c", seq: 0, source: "user", content: "做个决策", tags: [] }))).toBe(false);
  });

  it("isLinkRef only treats url kind or http(s) ids as external links", () => {
    expect(isLinkRef({ kind: "url", id: "https://x.test" } as Ref)).toBe(true);
    expect(isLinkRef({ kind: "note", id: "http://x.test" } as Ref)).toBe(true);
    expect(isLinkRef({ kind: "task", id: "task-1" } as Ref)).toBe(false);
    expect(isLinkRef({ kind: "commit", id: "abc123" } as Ref)).toBe(false);
  });
});
