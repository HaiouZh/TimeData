import { randomUUID } from "node:crypto";
import { RefSchema, TrackSchema, type SyncChange, type Track, type TrackStep } from "@timedata/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { rowToTrack, type TrackRow } from "../lib/track-rows.js";
import { notifySyncChange } from "../sync/notifier.js";
import { applyChange } from "../sync/resolver.js";
import { getLatestSeq } from "../sync/seq.js";

const agentTracks = new Hono();

const RequestIdSchema = z.string().trim().min(1).max(128);
const RefsSchema = z.array(RefSchema).max(100);

function invalidRequest(details: unknown, message = "Invalid track ingest body") {
  return { ok: false as const, error: { code: "INVALID_REQUEST", message, details } };
}

function trackChange(action: "create" | "update", track: Track, now: string): SyncChange {
  return { tableName: "tracks", action, recordId: track.id, timestamp: now, data: track };
}

function stepChange(action: "create" | "update", step: TrackStep, now: string): SyncChange {
  return { tableName: "track_steps", action, recordId: step.id, timestamp: now, data: step };
}

function applyChangesAndNotify(changes: SyncChange[]): void {
  const db = getDb();
  db.transaction(() => {
    for (const change of changes) applyChange(change);
  })();
  notifySyncChange(getLatestSeq());
}

function getTrack(id: string): Track | null {
  const row = getDb().prepare("SELECT * FROM tracks WHERE id = ?").get(id) as TrackRow | undefined;
  return row ? rowToTrack(row) : null;
}

const createTrackSchema = z
  .object({
    requestId: RequestIdSchema.optional(),
    title: z.string().trim().min(1).max(500),
    summary: z.string().max(5000).optional(),
    refs: RefsSchema.optional(),
    status: z.enum(["active", "concluded", "parked"]).optional(),
  })
  .strict();

agentTracks.post("/tracks", async (c) => {
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = createTrackSchema.safeParse(rawBody);
  if (!parsed.success) return c.json(invalidRequest(parsed.error.issues), 400);

  const id = parsed.data.requestId ?? randomUUID();
  const existing = getTrack(id);
  if (existing) return c.json({ ok: true, track: existing, idempotent: true });

  const now = new Date().toISOString();
  const track = TrackSchema.parse({
    id,
    title: parsed.data.title,
    ...(parsed.data.summary !== undefined ? { summary: parsed.data.summary } : {}),
    status: parsed.data.status ?? "active",
    refs: parsed.data.refs ?? [],
    createdAt: now,
    updatedAt: now,
  });

  applyChangesAndNotify([trackChange("create", track, now)]);
  return c.json({ ok: true, track, idempotent: false }, 201);
});

export default agentTracks;
