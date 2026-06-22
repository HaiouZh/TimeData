import { describe, expect, it } from "vitest";

import { RefSchema, TrackSchema, TrackStepSchema } from "./schemas.js";

const ts = "2026-06-21T00:00:00.000Z";
const rejectedTaskLinksKey = ["task", "Ids"].join("");
const rejectedJsonBlobKey = ["me", "ta"].join("");
const rejectedCommitKey = ["commit", "Sha"].join("");
const rejectedRuntimeKey = ["agent", "RuntimeMs"].join("");

describe("track schemas", () => {
  it("RefSchema accepts open kind/id and optional label", () => {
    expect(RefSchema.parse({ kind: "task", id: "task-1", label: "任务一" })).toEqual({
      kind: "task",
      id: "task-1",
      label: "任务一",
    });
    expect(RefSchema.parse({ kind: "commit", id: "abc123" })).toEqual({ kind: "commit", id: "abc123" });
    expect(RefSchema.safeParse({ kind: " ", id: "task-1" }).success).toBe(false);
    expect(RefSchema.safeParse({ kind: "task", id: "" }).success).toBe(false);
  });

  it("TrackSchema parses frozen spine, defaults refs, and strips rejected fields", () => {
    const parsed = TrackSchema.parse({
      id: "track-1",
      title: "T1 数据地基",
      status: "active",
      createdAt: ts,
      updatedAt: ts,
      [rejectedTaskLinksKey]: ["rejected"],
      [rejectedJsonBlobKey]: { rejected: true },
    });

    expect(parsed).toEqual({
      id: "track-1",
      title: "T1 数据地基",
      status: "active",
      refs: [],
      goalId: null,
      createdAt: ts,
      updatedAt: ts,
    });
    expect(Object.hasOwn(parsed, rejectedTaskLinksKey)).toBe(false);
    expect(Object.hasOwn(parsed, rejectedJsonBlobKey)).toBe(false);
  });

  it("TrackSchema allows summary and rejects done status", () => {
    expect(
      TrackSchema.parse({
        id: "track-1",
        title: "线",
        summary: "过程记录",
        status: "parked",
        refs: [],
        createdAt: ts,
        updatedAt: ts,
      }).summary,
    ).toBe("过程记录");
    expect(
      TrackSchema.safeParse({
        id: "track-1",
        title: "线",
        status: "done",
        refs: [],
        createdAt: ts,
        updatedAt: ts,
      }).success,
    ).toBe(false);
  });

  it("TrackStepSchema keeps content wide and defaults refs/tags", () => {
    const parsed = TrackStepSchema.parse({
      id: "step-1",
      trackId: "track-1",
      source: "agent",
      content: "",
      startedAt: ts,
      endedAt: null,
      seq: 0,
      createdAt: ts,
      updatedAt: ts,
      [rejectedCommitKey]: "rejected",
      [rejectedRuntimeKey]: 1234,
    });

    expect(parsed.content).toBe("");
    expect(parsed.refs).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(Object.hasOwn(parsed, rejectedCommitKey)).toBe(false);
    expect(Object.hasOwn(parsed, rejectedRuntimeKey)).toBe(false);
  });

  it("TrackStepSchema accepts instant spans and rejects reversed spans", () => {
    const base = {
      id: "step-1",
      trackId: "track-1",
      source: "user",
      content: "决策",
      startedAt: "2026-06-21T02:00:00.000Z",
      endedAt: "2026-06-21T02:00:00.000Z",
      refs: [{ kind: "task", id: "task-1" }],
      tags: ["phase:T1"],
      seq: 1,
      createdAt: ts,
      updatedAt: ts,
    };

    expect(TrackStepSchema.safeParse(base).success).toBe(true);
    expect(TrackStepSchema.safeParse({ ...base, endedAt: "2026-06-21T01:59:59.000Z" }).success).toBe(false);
  });

  it("TrackStepSchema rejects bad source, bad timestamps and negative seq", () => {
    const base = {
      id: "step-1",
      trackId: "track-1",
      source: "agent",
      content: "x",
      startedAt: ts,
      endedAt: null,
      refs: [],
      tags: [],
      seq: 0,
      createdAt: ts,
      updatedAt: ts,
    };

    expect(TrackStepSchema.safeParse({ ...base, source: "robot" }).success).toBe(false);
    expect(TrackStepSchema.safeParse({ ...base, startedAt: "2026-06-21" }).success).toBe(false);
    expect(TrackStepSchema.safeParse({ ...base, seq: -1 }).success).toBe(false);
    expect(TrackStepSchema.safeParse({ ...base, seq: 1.5 }).success).toBe(false);
  });
});
