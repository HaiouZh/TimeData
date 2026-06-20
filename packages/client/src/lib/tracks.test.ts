import "fake-indexeddb/auto";
import type { SyncLogEntry } from "@timedata/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/index.js";
import {
  addTrack,
  addTrackStep,
  deleteTrack,
  deleteTrackStep,
  getTrack,
  listTracks,
  listTrackSteps,
  updateTrack,
  updateTrackStep,
} from "./tracks.js";

const now = new Date("2026-06-21T08:00:00.000Z");
const later = new Date("2026-06-21T09:00:00.000Z");

beforeEach(async () => {
  await db.tracks.clear();
  await db.trackSteps.clear();
  await db.syncLog.clear();
});

describe("track local data layer", () => {
  it("addTrack trims title, defaults status/refs, and writes create syncLog", async () => {
    const track = await addTrack({ title: "  T1 数据地基  ", now });

    expect(track).toMatchObject({
      title: "T1 数据地基",
      status: "active",
      refs: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await expect(db.tracks.get(track.id)).resolves.toMatchObject({ title: "T1 数据地基" });
    await expect(db.syncLog.where("recordId").equals(track.id).toArray()).resolves.toMatchObject([
      { tableName: "tracks", action: "create", timestamp: now.toISOString(), synced: 0 },
    ]);
  });

  it("addTrack rejects empty title", async () => {
    await expect(addTrack({ title: "  " })).rejects.toThrow("轨道标题不能为空");
  });

  it("updateTrack updates editable fields, removes summary with null, and writes update syncLog", async () => {
    const track = await addTrack({ title: "旧标题", summary: "旧摘要", now });
    await db.syncLog.clear();

    const updated = await updateTrack(track.id, {
      title: "  新标题  ",
      summary: null,
      status: "parked",
      refs: [{ kind: "task", id: "task-1", label: "任务一" }],
      now: later,
    });

    expect(updated).toEqual({
      id: track.id,
      title: "新标题",
      status: "parked",
      refs: [{ kind: "task", id: "task-1", label: "任务一" }],
      createdAt: now.toISOString(),
      updatedAt: later.toISOString(),
    });
    await expect(db.syncLog.where("recordId").equals(track.id).toArray()).resolves.toMatchObject([
      { tableName: "tracks", action: "update", timestamp: later.toISOString(), synced: 0 },
    ]);
  });

  it("addTrackStep allows empty content, defaults refs/tags/seq, and writes create syncLog", async () => {
    const track = await addTrack({ title: "T1", now });
    await db.syncLog.clear();

    const step = await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "",
      startedAt: now.toISOString(),
      now,
    });

    expect(step).toMatchObject({
      trackId: track.id,
      source: "agent",
      content: "",
      endedAt: null,
      refs: [],
      tags: [],
      seq: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await expect(db.syncLog.where("recordId").equals(step.id).toArray()).resolves.toMatchObject([
      { tableName: "track_steps", action: "create", timestamp: now.toISOString(), synced: 0 },
    ]);
  });

  it("addTrackStep rejects missing tracks", async () => {
    await expect(
      addTrackStep({
        trackId: "missing-track",
        source: "agent",
        content: "x",
        startedAt: now.toISOString(),
      }),
    ).rejects.toThrow("轨道不存在");
  });

  it("addTrackStep defaults seq from the current max seq for the same track", async () => {
    const firstTrack = await addTrack({ title: "第一条线", now });
    const secondTrack = await addTrack({ title: "第二条线", now });

    const first = await addTrackStep({
      trackId: firstTrack.id,
      source: "user",
      content: "first",
      startedAt: now.toISOString(),
      seq: 7,
      now,
    });
    const secondTrackStep = await addTrackStep({
      trackId: secondTrack.id,
      source: "user",
      content: "other",
      startedAt: now.toISOString(),
      seq: 99,
      now,
    });
    const next = await addTrackStep({
      trackId: firstTrack.id,
      source: "agent",
      content: "next",
      startedAt: now.toISOString(),
      now,
    });

    expect(first.seq).toBe(7);
    expect(secondTrackStep.seq).toBe(99);
    expect(next.seq).toBe(8);
  });

  it("updateTrackStep accepts instant spans, removes sourceLabel with null, and writes update syncLog", async () => {
    const track = await addTrack({ title: "T1", now });
    const step = await addTrackStep({
      trackId: track.id,
      source: "agent",
      sourceLabel: "codex",
      content: "running",
      startedAt: now.toISOString(),
      now,
    });
    await db.syncLog.clear();

    const updated = await updateTrackStep(step.id, {
      sourceLabel: null,
      content: "closed",
      endedAt: now.toISOString(),
      refs: [{ kind: "url", id: "https://example.test" }],
      tags: ["phase:T1"],
      now: later,
    });

    expect(updated).toEqual({
      id: step.id,
      trackId: track.id,
      source: "agent",
      content: "closed",
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      refs: [{ kind: "url", id: "https://example.test" }],
      tags: ["phase:T1"],
      seq: 0,
      createdAt: now.toISOString(),
      updatedAt: later.toISOString(),
    });
    await expect(db.syncLog.where("recordId").equals(step.id).toArray()).resolves.toMatchObject([
      { tableName: "track_steps", action: "update", timestamp: later.toISOString(), synced: 0 },
    ]);
  });

  it("listTracks sorts by updatedAt desc, strips unknown fields, and warns on invalid rows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await db.tracks.put({
      id: "old",
      title: "旧",
      status: "active",
      refs: [],
      createdAt: "2026-06-21T07:00:00.000Z",
      updatedAt: "2026-06-21T07:00:00.000Z",
    });
    await db.tracks.put({
      id: "new",
      title: "新",
      status: "active",
      refs: [],
      createdAt: "2026-06-21T08:00:00.000Z",
      updatedAt: "2026-06-21T08:00:00.000Z",
      ghost: true,
    } as never);
    await db.tracks.put({
      id: "bad",
      title: "",
      status: "active",
      refs: [],
      createdAt: "2026-06-21T09:00:00.000Z",
      updatedAt: "2026-06-21T09:00:00.000Z",
    });

    const tracks = await listTracks();

    expect(tracks.map((track) => track.id)).toEqual(["new", "old"]);
    expect(tracks[0]).not.toHaveProperty("ghost");
    expect(warn).toHaveBeenCalled();
  });

  it("listTracks can filter by status", async () => {
    await addTrack({ title: "active", status: "active", now });
    await addTrack({ title: "parked", status: "parked", now });

    const parked = await listTracks("parked");

    expect(parked.map((track) => track.title)).toEqual(["parked"]);
  });

  it("listTrackSteps returns valid steps for one track sorted by seq", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const track = await addTrack({ title: "T1", now });
    const other = await addTrack({ title: "其他", now });
    const second = await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "second",
      startedAt: now.toISOString(),
      seq: 2,
      now,
    });
    const first = await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "first",
      startedAt: now.toISOString(),
      seq: 1,
      now,
    });
    await addTrackStep({
      trackId: other.id,
      source: "user",
      content: "other",
      startedAt: now.toISOString(),
      seq: 0,
      now,
    });
    await db.trackSteps.put({
      id: "bad-step",
      trackId: track.id,
      source: "agent",
      content: "bad",
      startedAt: "2026-06-21T09:00:00.000Z",
      endedAt: "2026-06-21T08:59:59.000Z",
      refs: [],
      tags: [],
      seq: 3,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const steps = await listTrackSteps(track.id);

    expect(steps.map((step) => step.id)).toEqual([first.id, second.id]);
    expect(warn).toHaveBeenCalled();
  });

  it("deleteTrack deletes steps first and writes tombstone logs for every row", async () => {
    const track = await addTrack({ title: "T1", now });
    const first = await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "a",
      startedAt: now.toISOString(),
      now,
    });
    const second = await addTrackStep({
      trackId: track.id,
      source: "agent",
      content: "b",
      startedAt: now.toISOString(),
      now,
    });
    await db.syncLog.clear();
    const addedLogs: SyncLogEntry[] = [];
    const addSyncLog = db.syncLog.add.bind(db.syncLog);
    vi.spyOn(db.syncLog, "add").mockImplementation(async (entry, key) => {
      addedLogs.push(entry as SyncLogEntry);
      return addSyncLog(entry, key);
    });

    await deleteTrack(track.id);

    await expect(db.tracks.get(track.id)).resolves.toBeUndefined();
    await expect(db.trackSteps.where("trackId").equals(track.id).count()).resolves.toBe(0);
    expect(addedLogs.map((log) => [log.tableName, log.recordId, log.action])).toEqual([
      ["track_steps", first.id, "delete"],
      ["track_steps", second.id, "delete"],
      ["tracks", track.id, "delete"],
    ]);
    expect((await db.syncLog.toArray()).map((log) => [log.tableName, log.recordId, log.action])).toEqual(
      expect.arrayContaining([
        ["track_steps", first.id, "delete"],
        ["track_steps", second.id, "delete"],
        ["tracks", track.id, "delete"],
      ]),
    );
  });

  it("deleteTrackStep deletes only one step", async () => {
    const track = await addTrack({ title: "T1", now });
    const step = await addTrackStep({
      trackId: track.id,
      source: "user",
      content: "x",
      startedAt: now.toISOString(),
      now,
    });
    await db.syncLog.clear();

    await deleteTrackStep(step.id);

    await expect(db.trackSteps.get(step.id)).resolves.toBeUndefined();
    await expect(db.tracks.get(track.id)).resolves.toBeDefined();
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "track_steps", recordId: step.id, action: "delete" },
    ]);
  });

  it("getTrack returns parsed tracks and undefined for missing or invalid tracks", async () => {
    const track = await addTrack({ title: "T1", now });
    await db.tracks.put({
      id: "invalid",
      title: "",
      status: "active",
      refs: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    await expect(getTrack(track.id)).resolves.toMatchObject({ title: "T1" });
    await expect(getTrack("missing")).resolves.toBeUndefined();
    await expect(getTrack("invalid")).resolves.toBeUndefined();
  });
});
