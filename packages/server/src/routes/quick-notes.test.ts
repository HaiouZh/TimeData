import type Database from "better-sqlite3";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupRouteTestDb, setupRouteTestApp } from "../__tests__/helpers.js";

let app: Hono;
let db: Database.Database;

function seedQuickNote(overrides: Partial<{
  id: string;
  text: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}> = {}): string {
  const id = overrides.id ?? `note-${Math.random().toString(36).slice(2)}`;
  const timestamp = overrides.createdAt ?? overrides.occurredAt ?? "2026-06-02T01:00:00.000Z";
  db.prepare(`
    INSERT INTO quick_notes (id, text, occurred_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.text ?? id,
    overrides.occurredAt ?? "2026-06-02T01:00:00.000Z",
    timestamp,
    overrides.updatedAt ?? timestamp,
  );
  return id;
}

beforeEach(async () => {
  const setup = await setupRouteTestApp("/api/quick-notes", "../routes/quick-notes.js");
  app = setup.app;
  db = setup.db;
  db.prepare("DELETE FROM quick_notes").run();
});

afterEach(() => {
  cleanupRouteTestDb(db);
});

describe("GET /api/quick-notes", () => {
  it("returns quick notes for one local date in CLI shape", async () => {
    seedQuickNote({ id: "early", text: "早晨", occurredAt: "2026-06-01T16:10:00.000Z" });
    seedQuickNote({ id: "late", text: "晚上", occurredAt: "2026-06-02T15:00:00.000Z" });
    seedQuickNote({ id: "outside", text: "隔天", occurredAt: "2026-06-02T16:00:00.000Z" });

    const res = await app.request("/api/quick-notes?date=2026-06-02&format=cli");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      mode: "date",
      date: "2026-06-02",
      quickNotes: [
        { id: "early", text: "早晨", occurredAt: "2026-06-01T16:10:00.000Z", occurredLocal: "2026-06-02T00:10:00" },
        { id: "late", text: "晚上", occurredAt: "2026-06-02T15:00:00.000Z", occurredLocal: "2026-06-02T23:00:00" },
      ],
      summary: { count: 2 },
    });
    expect(body.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("returns an inclusive local date range", async () => {
    seedQuickNote({ id: "first", occurredAt: "2026-06-01T16:00:00.000Z" });
    seedQuickNote({ id: "second", occurredAt: "2026-06-02T16:00:00.000Z" });
    seedQuickNote({ id: "outside", occurredAt: "2026-06-03T16:00:00.000Z" });

    const res = await app.request("/api/quick-notes?from=2026-06-02&to=2026-06-03&format=cli");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      mode: "range",
      from: "2026-06-02",
      to: "2026-06-03",
      quickNotes: [expect.objectContaining({ id: "first" }), expect.objectContaining({ id: "second" })],
      summary: { count: 2 },
    });
  });

  it("returns recent quick notes newest first", async () => {
    seedQuickNote({ id: "old", occurredAt: "2026-06-01T01:00:00.000Z" });
    seedQuickNote({ id: "mid", occurredAt: "2026-06-02T01:00:00.000Z" });
    seedQuickNote({ id: "new", occurredAt: "2026-06-03T01:00:00.000Z" });

    const res = await app.request("/api/quick-notes?recent=1&limit=2&format=cli");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      mode: "recent",
      quickNotes: [expect.objectContaining({ id: "new" }), expect.objectContaining({ id: "mid" })],
      summary: { count: 2 },
    });
  });

  it("rejects mixed query modes", async () => {
    const res = await app.request("/api/quick-notes?recent=1&date=2026-06-02&format=cli");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "--recent cannot be combined with --date, --from, or --to" },
    });
  });

  it("rejects reversed ranges", async () => {
    const res = await app.request("/api/quick-notes?from=2026-06-03&to=2026-06-02&format=cli");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "--to must be the same as or later than --from" },
    });
  });
});
