import { describe, expect, it } from "vitest";
import type { TrackStep } from "./types.js";
import {
  DEFAULT_TRACK_BOARD_SIGNALS,
  LEGACY_TRACK_ACTION_TAGS_KEY,
  TRACK_ACTION_TAGS_KEY,
  latestTrackBoardSignal,
  parseTrackBoardSignalsFromSettings,
  sanitizeTrackBoardSignals,
} from "./trackBoardSignals.js";

const T = "2026-06-24T00:00:00.000Z";

function step(partial: Partial<TrackStep> & { id: string; seq: number }): TrackStep {
  return {
    id: partial.id,
    trackId: partial.trackId ?? "track-1",
    source: partial.source ?? "agent",
    content: partial.content ?? "",
    startedAt: partial.startedAt ?? T,
    endedAt: partial.endedAt ?? T,
    refs: partial.refs ?? [],
    tags: partial.tags ?? [],
    seq: partial.seq,
    createdAt: partial.createdAt ?? T,
    updatedAt: partial.updatedAt ?? T,
    ...(partial.sourceLabel !== undefined ? { sourceLabel: partial.sourceLabel } : {}),
  };
}

describe("track board signals", () => {
  it("exports the synced setting keys and the new default signal list", () => {
    expect(TRACK_ACTION_TAGS_KEY).toBe("track.actionTags.v2");
    expect(LEGACY_TRACK_ACTION_TAGS_KEY).toBe("track.actionTags.v1");
    expect(DEFAULT_TRACK_BOARD_SIGNALS).toEqual(["待我处理", "agent在做"]);
  });

  it("sanitizes strings and legacy {tag} objects while preserving explicit empty config", () => {
    expect(sanitizeTrackBoardSignals([" 待我处理 ", { tag: "agent在做", court: "ignored" }, "", "待我处理"])).toEqual([
      "待我处理",
      "agent在做",
    ]);
    expect(parseTrackBoardSignalsFromSettings("[]", null)).toEqual([]);
  });

  it("normalizes invalid values and the old default to the new default", () => {
    expect(parseTrackBoardSignalsFromSettings(null, null)).toEqual(["待我处理", "agent在做"]);
    expect(parseTrackBoardSignalsFromSettings("not-json", null)).toEqual(["待我处理", "agent在做"]);
    expect(parseTrackBoardSignalsFromSettings(JSON.stringify(["等我", "待决策", "卡住", "agent在做"]), null)).toEqual([
      "待我处理",
      "agent在做",
    ]);
    expect(parseTrackBoardSignalsFromSettings(null, JSON.stringify(["等我", "待决策", "卡住", "agent在做"]))).toEqual([
      "待我处理",
      "agent在做",
    ]);
  });

  it("uses v2 before v1 and accepts early v2 object arrays", () => {
    expect(
      parseTrackBoardSignalsFromSettings(
        JSON.stringify([{ tag: "我来处理", court: "me" }]),
        JSON.stringify(["旧标签"]),
      ),
    ).toEqual(["我来处理"]);
  });

  it("finds the latest sticky board signal and ignores newer unconfigured tags", () => {
    expect(
      latestTrackBoardSignal(
        [
          step({ id: "agent", seq: 0, tags: ["agent在做"] }),
          step({ id: "note", seq: 1, tags: ["批注"] }),
          step({ id: "plain", seq: 2, tags: [] }),
        ],
        ["待我处理", "agent在做"],
      ),
    ).toEqual({ tag: "agent在做", stepId: "agent" });
  });

  it("uses board signal order when one step has multiple configured tags", () => {
    expect(latestTrackBoardSignal([step({ id: "multi", seq: 0, tags: ["agent在做", "待我处理"] })], ["待我处理", "agent在做"])).toEqual({
      tag: "待我处理",
      stepId: "multi",
    });
  });
});
