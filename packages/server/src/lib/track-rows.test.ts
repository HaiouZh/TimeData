import { describe, expect, it } from "vitest";

import { rowToTrack, rowToTrackStep, trackStepToRow, trackToRow } from "./track-rows.js";

const now = "2026-06-21T00:00:00.000Z";

describe("track rows", () => {
  it("maps tracks to JSON row columns and back", () => {
    const row = trackToRow({
      id: "track-1",
      title: "T1 数据地基",
      summary: "shared/server/client",
      status: "active",
      refs: [
        { kind: "task", id: "task-1", label: "任务一" },
        { kind: "url", id: "https://example.com/spec" },
      ],
      goalId: "goal-1",
      createdAt: now,
      updatedAt: now,
    });

    expect(row).toEqual({
      id: "track-1",
      title: "T1 数据地基",
      summary: "shared/server/client",
      status: "active",
      refs: JSON.stringify([
        { kind: "task", id: "task-1", label: "任务一" },
        { kind: "url", id: "https://example.com/spec" },
      ]),
      goal_id: "goal-1",
      created_at: now,
    });
    expect(
      rowToTrack({
        ...row,
        updated_at: now,
      }),
    ).toEqual({
      id: "track-1",
      title: "T1 数据地基",
      summary: "shared/server/client",
      status: "active",
      refs: [
        { kind: "task", id: "task-1", label: "任务一" },
        { kind: "url", id: "https://example.com/spec" },
      ],
      goalId: "goal-1",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("maps optional track summary and empty refs", () => {
    expect(
      rowToTrack({
        id: "track-1",
        title: "T1",
        summary: null,
        status: "parked",
        refs: null,
        goal_id: null,
        created_at: now,
        updated_at: now,
      }),
    ).toEqual({
      id: "track-1",
      title: "T1",
      status: "parked",
      refs: [],
      goalId: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("maps track steps to JSON row columns and back", () => {
    const row = trackStepToRow({
      id: "step-1",
      trackId: "track-1",
      source: "agent",
      sourceLabel: "codex",
      content: "",
      startedAt: now,
      endedAt: "2026-06-21T00:05:00.000Z",
      refs: [{ kind: "commit", id: "abc123" }],
      tags: ["phase:T1", "等我"],
      seq: 2,
      createdAt: now,
      updatedAt: now,
    });

    expect(row).toEqual({
      id: "step-1",
      track_id: "track-1",
      source: "agent",
      source_label: "codex",
      content: "",
      started_at: now,
      ended_at: "2026-06-21T00:05:00.000Z",
      refs: JSON.stringify([{ kind: "commit", id: "abc123" }]),
      tags: JSON.stringify(["phase:T1", "等我"]),
      seq: 2,
      created_at: now,
    });
    expect(rowToTrackStep({ ...row, updated_at: now })).toEqual({
      id: "step-1",
      trackId: "track-1",
      source: "agent",
      sourceLabel: "codex",
      content: "",
      startedAt: now,
      endedAt: "2026-06-21T00:05:00.000Z",
      refs: [{ kind: "commit", id: "abc123" }],
      tags: ["phase:T1", "等我"],
      seq: 2,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("maps nullable step fields and empty JSON columns", () => {
    expect(
      rowToTrackStep({
        id: "step-1",
        track_id: "track-1",
        source: "user",
        source_label: null,
        content: "决策",
        started_at: now,
        ended_at: null,
        refs: null,
        tags: null,
        seq: 0,
        created_at: now,
        updated_at: now,
      }),
    ).toEqual({
      id: "step-1",
      trackId: "track-1",
      source: "user",
      content: "决策",
      startedAt: now,
      endedAt: null,
      refs: [],
      tags: [],
      seq: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
});
