import type Database from "better-sqlite3";
import { TRACK_ACTION_TAGS_KEY } from "@timedata/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

const NOW = "2026-06-21T08:00:00.000Z";

let app: Hono;
let db: Database.Database;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  const setup = await setupRouteTestApp("/api/agent", "../routes/agent-tracks.js");
  app = setup.app;
  db = setup.db;
});

afterEach(() => {
  cleanupRouteTestDb(db);
  vi.useRealTimers();
});

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function get(path: string): Promise<Response> {
  return app.request(path, { method: "GET" });
}

async function patch(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function syncSeqCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM sync_seq").get() as { n: number }).n;
}

function seedSetting(key: string, value: string): void {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(key, value, "2026-06-21T00:00:00.000Z");
}

function seedTrack(
  id = "track-1",
  overrides: Partial<{
    title: string;
    summary: string | null;
    status: "active" | "concluded" | "parked";
    refs: unknown[];
    createdAt: string;
    updatedAt: string;
  }> = {},
): void {
  const createdAt = overrides.createdAt ?? "2026-06-21T00:00:00.000Z";
  db.prepare(`
    INSERT INTO tracks (id, title, summary, status, refs, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.title ?? "任务轨道",
    overrides.summary ?? null,
    overrides.status ?? "active",
    JSON.stringify(overrides.refs ?? []),
    createdAt,
    overrides.updatedAt ?? createdAt,
  );
}

function seedTrackStep(overrides: {
  id: string;
  trackId?: string;
  source?: "agent" | "user";
  sourceLabel?: string | null;
  content?: string;
  startedAt?: string;
  endedAt?: string | null;
  refs?: unknown[];
  tags?: string[];
  seq?: number;
}): void {
  db.prepare(`
    INSERT INTO track_steps (id, track_id, source, source_label, content, started_at, ended_at, refs, tags, seq, created_at, updated_at, edited_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.id,
    overrides.trackId ?? "track-1",
    overrides.source ?? "agent",
    overrides.sourceLabel ?? "codex",
    overrides.content ?? overrides.id,
    overrides.startedAt ?? "2026-06-21T01:00:00.000Z",
    overrides.endedAt ?? null,
    JSON.stringify(overrides.refs ?? []),
    JSON.stringify(overrides.tags ?? []),
    overrides.seq ?? 0,
    "2026-06-21T01:00:00.000Z",
    "2026-06-21T01:00:00.000Z",
    null,
  );
}

describe("GET /api/agent/tracks/context", () => {
  it("returns active tracks with board signals, recent steps and no write-side effects", async () => {
    seedSetting(TRACK_ACTION_TAGS_KEY, JSON.stringify(["agent在做", "待我处理"]));
    seedTrack("active-a", {
      title: "A 轨道",
      updatedAt: "2026-06-21T07:00:00.000Z",
      refs: [{ kind: "task", id: "task-a", label: "任务 A" }],
    });
    seedTrack("active-b", { title: "B 轨道", updatedAt: "2026-06-21T05:00:00.000Z" });
    seedTrack("parked-c", { title: "不应出现", status: "parked", updatedAt: "2026-06-21T09:00:00.000Z" });
    seedTrackStep({ id: "a0", trackId: "active-a", seq: 0, tags: ["agent在做"] });
    seedTrackStep({ id: "a1", trackId: "active-a", seq: 1, tags: ["批注"] });
    seedTrackStep({ id: "a2", trackId: "active-a", seq: 2, tags: [] });
    seedTrackStep({ id: "a3", trackId: "active-a", seq: 3, tags: ["待我处理", "agent在做"] });
    seedTrackStep({ id: "c0", trackId: "parked-c", seq: 0, tags: ["待我处理"] });

    const beforeSeq = syncSeqCount();
    const res = await get("/api/agent/tracks/context");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      boardSignals: string[];
      tracks: Array<{
        track: { id: string; refs: unknown[] };
        latestBoardSignal: string | null;
        stepCount: number;
        recentSteps: Array<{ id: string; tags: string[] }>;
      }>;
      bestMatch?: unknown;
      score?: unknown;
      recommendation?: unknown;
    };
    expect(body).toMatchObject({ ok: true, boardSignals: ["agent在做", "待我处理"] });
    expect(body.tracks.map((item) => item.track.id)).toEqual(["active-a", "active-b"]);
    expect(body.tracks[0]).toMatchObject({
      track: { id: "active-a", refs: [{ kind: "task", id: "task-a", label: "任务 A" }] },
      latestBoardSignal: "agent在做",
      stepCount: 4,
    });
    expect(body.tracks[0]?.recentSteps.map((step) => step.id)).toEqual(["a3", "a2", "a1"]);
    expect(body.tracks[1]).toMatchObject({ track: { id: "active-b" }, latestBoardSignal: null, stepCount: 0, recentSteps: [] });
    expect(body).not.toHaveProperty("bestMatch");
    expect(body).not.toHaveProperty("score");
    expect(body).not.toHaveProperty("recommendation");
    expect(body.tracks[0]).not.toHaveProperty("score");
    expect(syncSeqCount()).toBe(beforeSeq);
  });

  it("回填历史步(seq更大但 startedAt 更早)不出现在 recentSteps 首位", async () => {
    seedTrack("active-a", { title: "A 轨道", updatedAt: "2026-06-21T07:00:00.000Z" });
    seedTrackStep({
      id: "today",
      trackId: "active-a",
      seq: 3,
      startedAt: "2026-06-21T02:00:00.000Z",
      endedAt: "2026-06-21T03:00:00.000Z",
    });
    seedTrackStep({
      id: "backfill",
      trackId: "active-a",
      seq: 9,
      startedAt: "2026-06-20T02:00:00.000Z",
      endedAt: "2026-06-20T03:00:00.000Z",
    });

    const res = await get("/api/agent/tracks/context");
    const body = (await res.json()) as { tracks: Array<{ recentSteps: Array<{ id: string }> }> };

    expect(body.tracks[0]?.recentSteps[0]?.id).toBe("today");
  });
});

describe("GET /api/agent/tracks/:id/context", () => {
  it("returns one active track with full steps in ascending order and no write-side effects", async () => {
    seedTrack();
    seedTrackStep({ id: "s2", seq: 2, startedAt: "2026-06-21T03:00:00.000Z", tags: [] });
    seedTrackStep({ id: "s0", seq: 0, startedAt: "2026-06-21T01:00:00.000Z", tags: ["agent在做"] });
    seedTrackStep({ id: "s1", seq: 1, startedAt: "2026-06-21T02:00:00.000Z", tags: ["批注"] });

    const beforeSeq = syncSeqCount();
    const res = await get("/api/agent/tracks/track-1/context");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      boardSignals: string[];
      track: { id: string };
      latestBoardSignal: string | null;
      stepCount: number;
      steps: Array<{ id: string }>;
      bestMatch?: unknown;
      score?: unknown;
    };
    expect(body).toMatchObject({
      ok: true,
      boardSignals: ["待我处理", "agent在做"],
      track: { id: "track-1" },
      latestBoardSignal: "agent在做",
      stepCount: 3,
    });
    expect(body.steps.map((step) => step.id)).toEqual(["s0", "s1", "s2"]);
    expect(body).not.toHaveProperty("bestMatch");
    expect(body).not.toHaveProperty("score");
    expect(syncSeqCount()).toBe(beforeSeq);
  });

  it("returns 404 for missing track and 409 for non-active track", async () => {
    seedTrack("parked-1", { status: "parked" });

    const missing = await get("/api/agent/tracks/missing/context");
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    const inactive = await get("/api/agent/tracks/parked-1/context");
    expect(inactive.status).toBe(409);
    await expect(inactive.json()).resolves.toMatchObject({ ok: false, error: { code: "TRACK_NOT_ACTIVE" } });
  });
});

describe("POST /api/agent/tracks", () => {
  it("creates a track via applyChange, records seq and notifies listeners", async () => {
    const { addSyncStreamListener, removeSyncStreamListener } = await import("../sync/notifier.js");
    const seen: Array<number | null> = [];
    const listener = (seq: number | null) => seen.push(seq);
    addSyncStreamListener(listener);
    try {
      const res = await post("/api/agent/tracks", {
        requestId: "track-req-1",
        title: "任务轨道 T2",
        summary: "agent ingest",
        refs: [{ kind: "task", id: "task-1", label: "主任务" }],
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { ok: boolean; idempotent: boolean; track: { id: string; title: string } };
      expect(body).toMatchObject({
        ok: true,
        idempotent: false,
        track: { id: "track-req-1", title: "任务轨道 T2" },
      });
      expect(db.prepare("SELECT title, summary, status, refs FROM tracks WHERE id = ?").get("track-req-1")).toMatchObject({
        title: "任务轨道 T2",
        summary: "agent ingest",
        status: "active",
        refs: JSON.stringify([{ kind: "task", id: "task-1", label: "主任务" }]),
      });
      expect(db.prepare("SELECT table_name, record_id, action FROM sync_seq WHERE table_name = 'tracks'").all()).toEqual([
        { table_name: "tracks", record_id: "track-req-1", action: "create" },
      ]);
      expect(seen.at(-1)).toBeGreaterThan(0);
    } finally {
      removeSyncStreamListener(listener);
    }
  });

  it("returns existing track for the same requestId without writing another seq", async () => {
    const first = await post("/api/agent/tracks", { requestId: "track-req-2", title: "第一次" });
    const second = await post("/api/agent/tracks", { requestId: "track-req-2", title: "第二次不应覆盖" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      ok: true,
      idempotent: true,
      track: { id: "track-req-2", title: "第一次" },
    });
    expect(db.prepare("SELECT title FROM tracks WHERE id = ?").get("track-req-2")).toEqual({ title: "第一次" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM sync_seq WHERE table_name = 'tracks'").get() as { n: number }).n).toBe(
      1,
    );
  });

  it("rejects empty title, unknown fields and caller-supplied source", async () => {
    expect((await post("/api/agent/tracks", { title: "" })).status).toBe(400);
    expect((await post("/api/agent/tracks", { title: "x", bogus: 1 })).status).toBe(400);
    expect((await post("/api/agent/tracks", { title: "x", source: "agent" })).status).toBe(400);
  });
});

describe("POST /api/agent/tracks/:id/steps", () => {
  beforeEach(() => {
    seedTrack();
  });

  it("appends an agent step, closes open steps, records seq and notifies", async () => {
    seedTrackStep({ id: "open-step", startedAt: "2026-06-21T02:00:00.000Z", seq: 0 });
    const { addSyncStreamListener, removeSyncStreamListener } = await import("../sync/notifier.js");
    const seen: Array<number | null> = [];
    const listener = (seq: number | null) => seen.push(seq);
    addSyncStreamListener(listener);
    try {
      const res = await post("/api/agent/tracks/track-1/steps", {
        requestId: "step-req-1",
        sourceLabel: "claude",
        content: "实现路由测试",
        startedAt: "2026-06-21T03:00:00.000Z",
        refs: [{ kind: "commit", id: "abc123" }],
        tags: ["phase:T2"],
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        ok: boolean;
        idempotent: boolean;
        step: { id: string; source: string; sourceLabel?: string; seq: number; endedAt: string | null };
        closedSteps: Array<{ id: string; endedAt: string }>;
      };
      expect(body).toMatchObject({
        ok: true,
        idempotent: false,
        step: { id: "step-req-1", source: "agent", sourceLabel: "claude", seq: 1, endedAt: null },
        closedSteps: [{ id: "open-step", endedAt: "2026-06-21T03:00:00.000Z" }],
      });
      expect(db.prepare("SELECT ended_at FROM track_steps WHERE id = ?").get("open-step")).toEqual({
        ended_at: "2026-06-21T03:00:00.000Z",
      });
      expect(db.prepare("SELECT source, source_label, refs, tags, seq FROM track_steps WHERE id = ?").get("step-req-1"))
        .toMatchObject({
          source: "agent",
          source_label: "claude",
          refs: JSON.stringify([{ kind: "commit", id: "abc123" }]),
          tags: JSON.stringify(["phase:T2"]),
          seq: 1,
        });
      expect(db.prepare("SELECT record_id, action FROM sync_seq WHERE table_name = 'track_steps' ORDER BY id").all()).toEqual(
        [
          { record_id: "open-step", action: "update" },
          { record_id: "step-req-1", action: "create" },
        ],
      );
      expect(seen.at(-1)).toBeGreaterThan(0);
    } finally {
      removeSyncStreamListener(listener);
    }
  });

  it("returns 409 TRACK_NOT_ACTIVE when appending to a non-active track", async () => {
    seedTrack("archived-1", { status: "concluded" });
    const before = syncSeqCount();
    const res = await post("/api/agent/tracks/archived-1/steps", { content: "交接给你" });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: { code: "TRACK_NOT_ACTIVE" } });
    // 非 active 轨道不接受新步:不写 track_steps、不推进 seq。
    expect(db.prepare("SELECT COUNT(*) AS n FROM track_steps WHERE track_id = ?").get("archived-1")).toMatchObject({
      n: 0,
    });
    expect(syncSeqCount()).toBe(before);
  });

  it("defaults startedAt to now and endedAt to null (开口当前步)", async () => {
    const res = await post("/api/agent/tracks/track-1/steps", { content: "无时间默认" });
    const body = (await res.json()) as { step: { startedAt: string; endedAt: string | null; seq: number } };
    expect(body.step.startedAt).toBe(NOW);
    expect(body.step.endedAt).toBeNull();
    expect(body.step.seq).toBe(0);
  });

  it("returns existing step for the same requestId without closing another step again", async () => {
    seedTrackStep({ id: "open-step", startedAt: "2026-06-21T02:00:00.000Z", seq: 0 });
    const first = await post("/api/agent/tracks/track-1/steps", {
      requestId: "step-req-2",
      content: "第一次",
      startedAt: "2026-06-21T03:00:00.000Z",
    });
    const second = await post("/api/agent/tracks/track-1/steps", {
      requestId: "step-req-2",
      content: "第二次不应覆盖",
      startedAt: "2026-06-21T04:00:00.000Z",
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      ok: true,
      idempotent: true,
      step: { id: "step-req-2", content: "第一次" },
      closedSteps: [],
    });
    expect((db.prepare("SELECT COUNT(*) AS n FROM sync_seq WHERE table_name = 'track_steps'").get() as { n: number }).n)
      .toBe(2);
  });

  it("rejects missing track (404), caller source (400) and future startedAt beyond grace (400)", async () => {
    seedTrackStep({ id: "open-step", startedAt: "2026-06-21T05:00:00.000Z", seq: 0 });
    const missing = await post("/api/agent/tracks/missing/steps", { requestId: "step-x", content: "x" });
    const callerSource = await post("/api/agent/tracks/track-1/steps", {
      requestId: "step-y",
      source: "user",
      content: "x",
    });
    const reversed = await post("/api/agent/tracks/track-1/steps", {
      requestId: "step-z",
      content: "x",
      startedAt: "2026-06-21T08:10:01.000Z",
    });
    expect(missing.status).toBe(404);
    expect(callerSource.status).toBe(400);
    expect(reversed.status).toBe(400);
    expect(db.prepare("SELECT id FROM track_steps WHERE id IN ('step-y', 'step-z')").all()).toEqual([]);
  });

  it("rejects a single step whose endedAt precedes its own startedAt with 400, not 500", async () => {
    const res = await post("/api/agent/tracks/track-1/steps", {
      requestId: "step-self-reversed",
      content: "x",
      startedAt: "2026-06-21T05:00:00.000Z",
      endedAt: "2026-06-21T04:00:00.000Z",
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(db.prepare("SELECT id FROM track_steps WHERE id = 'step-self-reversed'").all()).toEqual([]);
  });

  it("rejects reusing a step requestId across tracks with 409", async () => {
    seedTrack("track-2");
    const first = await post("/api/agent/tracks/track-1/steps", { requestId: "shared-step", content: "在 track-1" });
    expect(first.status).toBe(201);
    const cross = await post("/api/agent/tracks/track-2/steps", {
      requestId: "shared-step",
      content: "想复用到 track-2",
    });
    expect(cross.status).toBe(409);
    await expect(cross.json()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });
});

describe("POST /api/agent/tracks/:id/current-step/close", () => {
  beforeEach(() => {
    seedTrack();
  });

  it("closes all open steps (轨道不结束), notifies, leaves older closed steps alone", async () => {
    seedTrackStep({
      id: "old-closed",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: "2026-06-21T01:30:00.000Z",
      seq: 0,
    });
    seedTrackStep({ id: "latest-open", startedAt: "2026-06-21T02:00:00.000Z", seq: 1 });
    seedTrackStep({ id: "future-open", startedAt: "2026-06-21T04:00:00.000Z", seq: 2 });
    const { addSyncStreamListener, removeSyncStreamListener } = await import("../sync/notifier.js");
    const seen: Array<number | null> = [];
    const listener = (seq: number | null) => seen.push(seq);
    addSyncStreamListener(listener);
    try {
      const res = await post("/api/agent/tracks/track-1/current-step/close", {
        endedAt: "2026-06-21T03:00:00.000Z",
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        closedSteps: [
          { id: "latest-open", endedAt: "2026-06-21T03:00:00.000Z" },
          { id: "future-open", endedAt: "2026-06-21T04:00:00.000Z" },
        ],
      });
      expect(db.prepare("SELECT ended_at FROM track_steps WHERE id = ?").get("latest-open")).toEqual({
        ended_at: "2026-06-21T03:00:00.000Z",
      });
      expect(db.prepare("SELECT ended_at FROM track_steps WHERE id = ?").get("future-open")).toEqual({
        ended_at: "2026-06-21T04:00:00.000Z",
      });
      expect(db.prepare("SELECT status FROM tracks WHERE id = ?").get("track-1")).toEqual({ status: "active" });
      expect(db.prepare("SELECT record_id, action FROM sync_seq WHERE table_name = 'track_steps'").all()).toEqual(
        expect.arrayContaining([
          { record_id: "latest-open", action: "update" },
          { record_id: "future-open", action: "update" },
        ]),
      );
      expect(seen.at(-1)).toBeGreaterThan(0);
    } finally {
      removeSyncStreamListener(listener);
    }
  });

  it("defaults endedAt to now", async () => {
    seedTrackStep({ id: "open", startedAt: "2026-06-21T02:00:00.000Z", seq: 0 });
    const res = await post("/api/agent/tracks/track-1/current-step/close", {});
    await expect(res.json()).resolves.toMatchObject({ ok: true, closedSteps: [{ id: "open", endedAt: NOW }] });
  });

  it("returns 409 when the track has no open step, 404 for missing track", async () => {
    seedTrackStep({
      id: "closed",
      startedAt: "2026-06-21T01:00:00.000Z",
      endedAt: "2026-06-21T02:00:00.000Z",
      seq: 0,
    });
    const noOpen = await post("/api/agent/tracks/track-1/current-step/close", {});
    const missing = await post("/api/agent/tracks/missing/current-step/close", {});
    expect(noOpen.status).toBe(409);
    await expect(noOpen.json()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(missing.status).toBe(404);
  });
});

describe("PATCH /api/agent/tracks/:id", () => {
  beforeEach(() => {
    seedTrack();
  });

  it("updates title, summary and refs", async () => {
    const res = await patch("/api/agent/tracks/track-1", {
      title: "新标题",
      summary: "新简介",
      refs: [{ kind: "url", id: "https://example.test", label: "参考" }],
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      track: { id: "track-1", title: "新标题", summary: "新简介" },
      closedSteps: [],
    });
    expect(db.prepare("SELECT title, summary, refs FROM tracks WHERE id = ?").get("track-1")).toMatchObject({
      title: "新标题",
      summary: "新简介",
      refs: JSON.stringify([{ kind: "url", id: "https://example.test", label: "参考" }]),
    });
  });

  it("clears summary with summary:null", async () => {
    db.prepare("UPDATE tracks SET summary = ? WHERE id = ?").run("旧简介", "track-1");
    const res = await patch("/api/agent/tracks/track-1", { summary: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { track: { summary?: string } };
    expect(Object.hasOwn(body.track, "summary")).toBe(false);
    expect(db.prepare("SELECT summary FROM tracks WHERE id = ?").get("track-1")).toEqual({ summary: null });
  });

  it("status=concluded closes all open steps (closedAt) and updates track", async () => {
    seedTrackStep({ id: "open-step", startedAt: "2026-06-21T02:00:00.000Z", seq: 0 });
    seedTrackStep({ id: "future-step", startedAt: "2026-06-21T04:00:00.000Z", seq: 1 });
    const res = await patch("/api/agent/tracks/track-1", {
      status: "concluded",
      closedAt: "2026-06-21T03:00:00.000Z",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      track: { id: "track-1", status: "concluded" },
      closedSteps: [
        { id: "open-step", endedAt: "2026-06-21T03:00:00.000Z" },
        { id: "future-step", endedAt: "2026-06-21T04:00:00.000Z" },
      ],
    });
    expect(db.prepare("SELECT ended_at FROM track_steps WHERE id = ?").get("open-step")).toEqual({
      ended_at: "2026-06-21T03:00:00.000Z",
    });
    expect(db.prepare("SELECT ended_at FROM track_steps WHERE id = ?").get("future-step")).toEqual({
      ended_at: "2026-06-21T04:00:00.000Z",
    });
    expect(
      db
        .prepare("SELECT table_name, record_id, action FROM sync_seq WHERE table_name IN ('track_steps', 'tracks') ORDER BY id")
        .all(),
    ).toEqual([
      { table_name: "track_steps", record_id: "open-step", action: "update" },
      { table_name: "track_steps", record_id: "future-step", action: "update" },
      { table_name: "tracks", record_id: "track-1", action: "update" },
    ]);
  });

  it("status=parked keeps the open step open", async () => {
    seedTrackStep({ id: "open-step", startedAt: "2026-06-21T02:00:00.000Z", seq: 0 });
    const res = await patch("/api/agent/tracks/track-1", { status: "parked" });
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      track: { id: "track-1", status: "parked" },
      closedSteps: [],
    });
    expect(db.prepare("SELECT ended_at FROM track_steps WHERE id = ?").get("open-step")).toEqual({ ended_at: null });
  });

  it("rejects empty body, closedAt without concluded, unknown field, and 404 for missing track", async () => {
    expect((await patch("/api/agent/tracks/track-1", {})).status).toBe(400);
    expect((await patch("/api/agent/tracks/track-1", { closedAt: "2026-06-21T03:00:00.000Z" })).status).toBe(400);
    expect((await patch("/api/agent/tracks/track-1", { done: true })).status).toBe(400);
    expect((await patch("/api/agent/tracks/missing", { status: "active" })).status).toBe(404);
  });
});

describe("scoped auth (mounted under /api/agent/*)", () => {
  it("rejects without token and accepts with AGENT_TOKEN", async () => {
    process.env.AGENT_TOKEN = "agent-secret";
    delete process.env.AUTH_TOKEN;
    delete process.env.ALLOW_UNAUTHENTICATED_DEV;
    try {
      const { scopedAuthMiddleware } = await import("../middleware/auth.js");
      const guarded = new Hono();
      guarded.use("/api/agent/*", scopedAuthMiddleware);
      guarded.route("/api/agent", (await import("../routes/agent-tracks.js")).default);

      const unauth = await guarded.request("/api/agent/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      });
      expect(unauth.status).toBe(401);
      const unauthContext = await guarded.request("/api/agent/tracks/context", { method: "GET" });
      expect(unauthContext.status).toBe(401);

      const authed = await guarded.request("/api/agent/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer agent-secret" },
        body: JSON.stringify({ title: "x" }),
      });
      expect(authed.status).toBe(201);
      const authedContext = await guarded.request("/api/agent/tracks/context", {
        method: "GET",
        headers: { Authorization: "Bearer agent-secret" },
      });
      expect(authedContext.status).toBe(200);
      await expect(authedContext.json()).resolves.toMatchObject({ ok: true });
    } finally {
      delete process.env.AGENT_TOKEN;
    }
  });
});
