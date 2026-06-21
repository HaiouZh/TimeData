import type { Ref, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import type { InboxEntry } from "./tracksView.js";
import {
  actionableInbox,
  currentStepId,
  formatStepDuration,
  groupStepsByTrack,
  isDecisionStep,
  isLinkRef,
  matchesActionTags,
  orderedTimeline,
  partitionTracks,
  stepSourceText,
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

  it("isLinkRef only treats http(s) ids as external links", () => {
    expect(isLinkRef({ kind: "url", id: "https://x.test" } as Ref)).toBe(true);
    expect(isLinkRef({ kind: "note", id: "http://x.test" } as Ref)).toBe(true);
    expect(isLinkRef({ kind: "task", id: "task-1" } as Ref)).toBe(false);
    expect(isLinkRef({ kind: "commit", id: "abc123" } as Ref)).toBe(false);
    // 协议白名单:危险协议或缺协议的 url 型 ref 都不放行,杜绝 javascript: 进 href
    expect(isLinkRef({ kind: "url", id: "javascript:alert(1)" } as Ref)).toBe(false);
    expect(isLinkRef({ kind: "url", id: "x.test" } as Ref)).toBe(false);
  });

  it("stepSourceText labels user as 我 and falls back to agent", () => {
    expect(stepSourceText(step({ id: "a", seq: 0, source: "user" }))).toBe("我");
    expect(stepSourceText(step({ id: "b", seq: 0, source: "agent", sourceLabel: "codex" }))).toBe("codex");
    expect(stepSourceText(step({ id: "c", seq: 0, source: "agent" }))).toBe("agent");
  });

  it("matchesActionTags intersects step tags with action tags, trimming both", () => {
    expect(matchesActionTags(["等我"], ["等我", "卡住"])).toBe(true);
    expect(matchesActionTags([" 等我 "], ["等我"])).toBe(true);
    expect(matchesActionTags(["进行中"], ["等我"])).toBe(false);
    expect(matchesActionTags(["等我"], [])).toBe(false);
  });

  it("actionableInbox surfaces current open steps of active tracks hitting actionTags, oldest first", () => {
    const tracks = [track("a1", "active"), track("a2", "active"), track("p1", "parked"), track("c1", "concluded")];
    const steps = [
      step({ id: "s-a1", seq: 1, trackId: "a1", endedAt: null, startedAt: "2026-06-21T05:00:00.000Z", tags: ["等我"] }),
      step({ id: "s-a1-old", seq: 0, trackId: "a1", endedAt: "2026-06-21T01:00:00.000Z", tags: ["等我"] }),
      step({ id: "s-a2", seq: 0, trackId: "a2", endedAt: null, startedAt: "2026-06-21T02:00:00.000Z", tags: ["卡住"] }),
      step({ id: "s-p1", seq: 0, trackId: "p1", endedAt: null, startedAt: T, tags: ["等我"] }),
      step({ id: "s-c1", seq: 0, trackId: "c1", endedAt: null, startedAt: T, tags: ["等我"] }),
    ];
    const inbox: InboxEntry[] = actionableInbox(tracks, groupStepsByTrack(steps), ["等我", "卡住"]);
    // parked/concluded 排除;闭合的历史步排除;a2(02:00)早于 a1(05:00)→ a2 在前。
    expect(inbox.map((e) => e.step.id)).toEqual(["s-a2", "s-a1"]);
    expect(inbox.map((e) => e.track.id)).toEqual(["a2", "a1"]);
  });

  it("actionableInbox returns nothing when actionTags is empty", () => {
    const tracks = [track("a1", "active")];
    const steps = [step({ id: "s", seq: 0, trackId: "a1", endedAt: null, tags: ["等我"] })];
    expect(actionableInbox(tracks, groupStepsByTrack(steps), [])).toEqual([]);
  });
});
