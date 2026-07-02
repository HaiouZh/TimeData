import type { Track } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import type { TrackBoardItem } from "../lib/tracksView.js";
import { countAttentionTracks } from "./useTrackAttentionCount.js";

function track(id: string): Track {
  return { id, title: id, status: "active", refs: [], createdAt: "2026-07-02T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z" };
}

function item(id: string, tag: string | null): TrackBoardItem {
  return { track: track(id), signal: tag ? { tag, stepId: `${id}-s` } : null };
}

describe("countAttentionTracks", () => {
  it("counts active items whose current signal equals the attention tag", () => {
    const items = [item("a", "待我处理"), item("b", "agent在做"), item("c", "待我处理"), item("d", null)];
    expect(countAttentionTracks(items, "待我处理")).toBe(2);
  });

  it("returns 0 when no attention tag is configured", () => {
    expect(countAttentionTracks([item("a", "待我处理")], undefined)).toBe(0);
  });

  it("returns 0 when nothing carries the attention signal", () => {
    expect(countAttentionTracks([item("a", "agent在做"), item("b", null)], "待我处理")).toBe(0);
  });
});
