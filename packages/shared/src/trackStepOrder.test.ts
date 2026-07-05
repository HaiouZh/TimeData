import { describe, expect, it } from "vitest";
import type { TrackStep } from "./types.js";
import {
  compareTrackStepsBySemanticTime,
  latestOpenStep,
  latestTrackStep,
  listOpenSteps,
} from "./trackStepOrder.js";

function step(partial: Partial<TrackStep> & { id: string }): TrackStep {
  return {
    id: partial.id,
    trackId: "t1",
    source: "user",
    content: "",
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: null,
    refs: [],
    tags: [],
    seq: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

describe("compareTrackStepsBySemanticTime", () => {
  it("startedAt 为第一键：昨天的回填步(seq更大)排在今天之前", () => {
    const backfill = step({ id: "b", seq: 9, startedAt: "2026-07-01T00:00:00.000Z" });
    const today = step({ id: "a", seq: 3, startedAt: "2026-07-02T00:00:00.000Z" });

    expect([today, backfill].sort(compareTrackStepsBySemanticTime).map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("同刻按 seq、再按 id 裁决", () => {
    const x = step({ id: "x", seq: 1 });
    const y = step({ id: "y", seq: 1 });
    const z = step({ id: "z", seq: 2 });

    expect([z, y, x].sort(compareTrackStepsBySemanticTime).map((s) => s.id)).toEqual(["x", "y", "z"]);
  });
});

describe("latestOpenStep", () => {
  it("同 seq 撞车时取 startedAt/id 较大的", () => {
    const a = step({ id: "a", seq: 1, startedAt: "2026-07-01T00:00:00.000Z" });
    const b = step({ id: "b", seq: 1, startedAt: "2026-07-01T01:00:00.000Z" });

    expect(latestOpenStep([a, b])?.id).toBe("b");
  });

  it("忽略已闭合步；空数组返回 null", () => {
    const closed = step({ id: "c", endedAt: "2026-07-01T02:00:00.000Z" });

    expect(latestOpenStep([closed])).toBeNull();
    expect(latestOpenStep([])).toBeNull();
  });
});

describe("latestTrackStep / listOpenSteps", () => {
  it("latestTrackStep 含闭合步取语义时间最大", () => {
    const open = step({ id: "o", startedAt: "2026-07-01T00:00:00.000Z" });
    const closedLater = step({
      id: "c",
      startedAt: "2026-07-02T00:00:00.000Z",
      endedAt: "2026-07-02T01:00:00.000Z",
    });

    expect(latestTrackStep([open, closedLater])?.id).toBe("c");
  });

  it("listOpenSteps 只含开口步、升序", () => {
    const a = step({ id: "a", startedAt: "2026-07-01T00:00:00.000Z" });
    const b = step({ id: "b", startedAt: "2026-07-02T00:00:00.000Z" });
    const closed = step({ id: "c", endedAt: "2026-07-01T00:00:00.000Z" });

    expect(listOpenSteps([b, closed, a]).map((s) => s.id)).toEqual(["a", "b"]);
  });
});
