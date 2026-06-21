import type Database from "better-sqlite3";
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

async function patch(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedTrack(id = "track-1"): void {
  db.prepare(`
    INSERT INTO tracks (id, title, summary, status, refs, created_at, updated_at)
    VALUES (?, ?, NULL, 'active', '[]', ?, ?)
  `).run(id, "任务轨道", "2026-06-21T00:00:00.000Z", "2026-06-21T00:00:00.000Z");
}

function seedTrackStep(overrides: {
  id: string;
  trackId?: string;
  content?: string;
  startedAt?: string;
  endedAt?: string | null;
  seq?: number;
}): void {
  db.prepare(`
    INSERT INTO track_steps (id, track_id, source, source_label, content, started_at, ended_at, refs, tags, seq, created_at, updated_at)
    VALUES (?, ?, 'agent', 'codex', ?, ?, ?, '[]', '[]', ?, ?, ?)
  `).run(
    overrides.id,
    overrides.trackId ?? "track-1",
    overrides.content ?? overrides.id,
    overrides.startedAt ?? "2026-06-21T01:00:00.000Z",
    overrides.endedAt ?? null,
    overrides.seq ?? 0,
    "2026-06-21T01:00:00.000Z",
    "2026-06-21T01:00:00.000Z",
  );
}

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
