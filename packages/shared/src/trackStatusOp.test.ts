import { describe, expect, it } from "vitest";
import type { Track } from "./types.js";
import { trackStatusOp } from "./trackStatusOp.js";

const T = "2026-07-04T00:00:00.000Z";

function track(partial: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    title: "轨道",
    status: "active",
    refs: [],
    createdAt: T,
    updatedAt: T,
    ...partial,
  };
}

describe("trackStatusOp", () => {
  it("status 变化时返回 status op", () => {
    expect(trackStatusOp(track({ status: "active" }), track({ status: "concluded" }), T)).toEqual({
      type: "status",
      at: T,
    });
  });

  it("status 没变时返回 undefined", () => {
    expect(trackStatusOp(track({ status: "active" }), track({ status: "active", title: "新标题" }), T)).toBeUndefined();
  });

  it("prev undefined 且新建非 active 状态时返回 op", () => {
    expect(trackStatusOp(undefined, track({ status: "parked" }), T)).toEqual({ type: "status", at: T });
  });
});
