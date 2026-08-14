import type { Track, TrackStep } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { todoTrackRows } from "./todoTrackRows.js";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

function makeTrack(patch: Partial<Track> = {}): Track {
  return {
    id: "tr1",
    title: "轨道",
    status: "active",
    refs: [],
    createdAt: iso(3 * DAY),
    updatedAt: iso(1 * DAY),
    ...patch,
  };
}

function makeStep(patch: Partial<TrackStep> = {}): TrackStep {
  return {
    id: "s1",
    trackId: "tr1",
    source: "user",
    content: "一步",
    startedAt: iso(1 * DAY),
    endedAt: iso(1 * DAY),
    refs: [],
    tags: [],
    seq: 1,
    createdAt: iso(1 * DAY),
    updatedAt: iso(1 * DAY),
    ...patch,
  };
}

describe("todoTrackRows", () => {
  it("已被任务徽章认领的轨道不成行", () => {
    const rows = todoTrackRows([makeTrack()], new Map(), new Set(["tr1"]), NOW);
    expect(rows).toEqual([]);
  });

  it("有开口步的轨道落今天", () => {
    const steps = [makeStep({ endedAt: null })];
    const rows = todoTrackRows([makeTrack()], new Map([["tr1", steps]]), new Set(), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].zone).toBe("today");
    expect(rows[0].hasOpenStep).toBe(true);
    expect(rows[0].stepCount).toBe(1);
  });

  it("一步没写的轨道也落今天", () => {
    const rows = todoTrackRows([makeTrack()], new Map(), new Set(), NOW);
    expect(rows[0].zone).toBe("today");
    expect(rows[0].stepCount).toBe(0);
    expect(rows[0].hasOpenStep).toBe(false);
  });

  it("停滞超阈值的轨道落在等", () => {
    const track = makeTrack({ createdAt: iso(30 * DAY), updatedAt: iso(30 * DAY) });
    const steps = [makeStep({ startedAt: iso(30 * DAY), endedAt: iso(30 * DAY) })];
    const rows = todoTrackRows([track], new Map([["tr1", steps]]), new Set(), NOW);
    expect(rows[0].zone).toBe("waiting");
  });

  it("非 active 轨道不成行", () => {
    const rows = todoTrackRows([makeTrack({ status: "concluded" })], new Map(), new Set(), NOW);
    expect(rows).toEqual([]);
  });

  it("按最近活动倒序，无步者用 createdAt 兜底", () => {
    const older = makeTrack({ id: "old", createdAt: iso(5 * DAY), updatedAt: iso(5 * DAY) });
    const newer = makeTrack({ id: "new", createdAt: iso(1 * DAY), updatedAt: iso(1 * DAY) });
    const rows = todoTrackRows([older, newer], new Map(), new Set(), NOW);
    expect(rows.map((r) => r.track.id)).toEqual(["new", "old"]);
  });
});
