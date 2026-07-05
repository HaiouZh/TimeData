import { randomUUID } from "node:crypto";
import {
  LEGACY_TRACK_ACTION_TAGS_KEY,
  RefSchema,
  TRACK_ACTION_TAGS_KEY,
  TrackSchema,
  TrackStepSchema,
  trackStatusOp,
  type SyncChange,
  type Track,
  type TrackStatusOp,
  type TrackStep,
  UtcIsoStringSchema,
  latestTrackBoardSignal,
  parseTrackBoardSignalsFromSettings,
} from "@timedata/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/connection.js";
import { rowToTrack, rowToTrackStep, type TrackRow, type TrackStepRow } from "../lib/track-rows.js";
import { notifySyncChange } from "../sync/notifier.js";
import { applyChange } from "../sync/resolver.js";
import { getLatestSeq } from "../sync/seq.js";

const agentTracks = new Hono();

const RequestIdSchema = z.string().trim().min(1).max(128);
const SourceLabelSchema = z.string().trim().min(1).max(64);
const ContentSchema = z.string().max(20_000);
const RefsSchema = z.array(RefSchema).max(100);
const FUTURE_STARTED_AT_GRACE_MS = 5 * 60_000;

function invalidRequest(details: unknown, message = "Invalid track ingest body") {
  return { ok: false as const, error: { code: "INVALID_REQUEST", message, details } };
}

function trackChange(action: "create" | "update", track: Track, now: string, op?: TrackStatusOp): SyncChange {
  return { tableName: "tracks", action, recordId: track.id, timestamp: now, data: track, ...(op ? { op } : {}) };
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

function getStep(id: string): TrackStep | null {
  const row = getDb().prepare("SELECT * FROM track_steps WHERE id = ?").get(id) as TrackStepRow | undefined;
  return row ? rowToTrackStep(row) : null;
}

function getSettingValue(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

function readTrackBoardSignals(): string[] {
  return parseTrackBoardSignalsFromSettings(
    getSettingValue(TRACK_ACTION_TAGS_KEY),
    getSettingValue(LEGACY_TRACK_ACTION_TAGS_KEY),
  );
}

function listActiveTracks(): Track[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM tracks
      WHERE status = 'active'
      ORDER BY updated_at DESC, title ASC, id ASC
    `)
    .all() as TrackRow[];
  return rows.map(rowToTrack);
}

function listTrackStepsAsc(trackId: string): TrackStep[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM track_steps
      WHERE track_id = ?
      ORDER BY started_at ASC, seq ASC, id ASC
    `)
    .all(trackId) as TrackStepRow[];
  return rows.map(rowToTrackStep);
}

function latestBoardSignalTag(steps: readonly TrackStep[], boardSignals: readonly string[]): string | null {
  return latestTrackBoardSignal(steps, boardSignals)?.tag ?? null;
}

function trackContextSummary(track: Track, boardSignals: readonly string[]) {
  const allSteps = listTrackStepsAsc(track.id);
  return {
    track,
    latestBoardSignal: latestBoardSignalTag(allSteps, boardSignals),
    stepCount: allSteps.length,
    recentSteps: [...allSteps].slice(-3).reverse(),
  };
}

function notFoundTrack() {
  return { ok: false as const, error: { code: "NOT_FOUND", message: "Track not found" } };
}

function listOpenSteps(trackId: string): TrackStep[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM track_steps
      WHERE track_id = ? AND ended_at IS NULL
      ORDER BY started_at ASC, seq ASC, id ASC
    `)
    .all(trackId) as TrackStepRow[];
  return rows.map(rowToTrackStep);
}

function nextStepSeq(trackId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM track_steps WHERE track_id = ?")
    .get(trackId) as { next: number };
  return row.next;
}

function closeStep(step: TrackStep, endedAt: string, updatedAt: string): TrackStep {
  const clampedEndedAt = endedAt < step.startedAt ? step.startedAt : endedAt;
  return TrackStepSchema.parse({ ...step, endedAt: clampedEndedAt, updatedAt });
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

const appendStepSchema = z
  .object({
    requestId: RequestIdSchema.optional(),
    sourceLabel: SourceLabelSchema.optional(),
    content: ContentSchema,
    startedAt: UtcIsoStringSchema.optional(),
    endedAt: UtcIsoStringSchema.nullable().optional(),
    refs: RefsSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  })
  .strict();

const closeStepSchema = z.object({ endedAt: UtcIsoStringSchema.optional() }).strict();

const patchTrackSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    summary: z.string().max(5000).nullable().optional(),
    status: z.enum(["active", "concluded", "parked"]).optional(),
    refs: RefsSchema.optional(),
    closedAt: UtcIsoStringSchema.optional(),
  })
  .strict()
  .refine((body) => body.title !== undefined || body.summary !== undefined || body.status !== undefined || body.refs !== undefined, {
    message: "at least one track field is required",
  })
  .refine((body) => body.closedAt === undefined || body.status === "concluded", {
    message: "closedAt is only valid when status is concluded",
  });

agentTracks.get("/tracks/context", (c) => {
  const boardSignals = readTrackBoardSignals();
  return c.json({
    ok: true,
    boardSignals,
    tracks: listActiveTracks().map((track) => trackContextSummary(track, boardSignals)),
  });
});

agentTracks.get("/tracks/:id/context", (c) => {
  const id = c.req.param("id");
  const track = getTrack(id);
  if (!track) return c.json(notFoundTrack(), 404);
  if (track.status !== "active") {
    return c.json(
      {
        ok: false,
        error: { code: "TRACK_NOT_ACTIVE", message: "Track is not active" },
      },
      409,
    );
  }

  const boardSignals = readTrackBoardSignals();
  const steps = listTrackStepsAsc(id);
  return c.json({
    ok: true,
    boardSignals,
    track,
    latestBoardSignal: latestBoardSignalTag(steps, boardSignals),
    stepCount: steps.length,
    steps,
  });
});

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

agentTracks.post("/tracks/:id/steps", async (c) => {
  const trackId = c.req.param("id");
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = appendStepSchema.safeParse(rawBody);
  if (!parsed.success) return c.json(invalidRequest(parsed.error.issues), 400);

  const track = getTrack(trackId);
  if (!track) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Track not found" } }, 404);
  // 与 GET /:id/context 口径一致：非 active 轨道不接受续写，避免交接步静默落进已归档轨道（TK-04）。
  if (track.status !== "active") {
    return c.json({ ok: false, error: { code: "TRACK_NOT_ACTIVE", message: "Track is not active" } }, 409);
  }

  const stepId = parsed.data.requestId ?? randomUUID();
  const existing = getStep(stepId);
  if (existing) {
    if (existing.trackId !== trackId) {
      return c.json({ ok: false, error: { code: "CONFLICT", message: "Step requestId belongs to another track" } }, 409);
    }
    return c.json({ ok: true, step: existing, closedSteps: [], closedStep: null, idempotent: true });
  }

  const now = new Date().toISOString();
  const startedAt = parsed.data.startedAt ?? now;
  const endedAt = parsed.data.endedAt ?? null;
  if (new Date(startedAt).getTime() > Date.now() + FUTURE_STARTED_AT_GRACE_MS) {
    return c.json(invalidRequest({ startedAt }, "startedAt cannot be in the future"), 400);
  }
  if (endedAt !== null && endedAt < startedAt) {
    return c.json(invalidRequest({ startedAt, endedAt }, "endedAt cannot be before startedAt"), 400);
  }
  const step = TrackStepSchema.parse({
    id: stepId,
    trackId,
    source: "agent",
    ...(parsed.data.sourceLabel ? { sourceLabel: parsed.data.sourceLabel } : {}),
    content: parsed.data.content,
    startedAt,
    endedAt,
    refs: parsed.data.refs ?? [],
    tags: parsed.data.tags ?? [],
    seq: nextStepSeq(trackId),
    createdAt: now,
    updatedAt: now,
  });

  const changes: SyncChange[] = [];
  const closedSteps = listOpenSteps(trackId).map((openStep) => closeStep(openStep, startedAt, now));
  for (const closed of closedSteps) {
    changes.push(stepChange("update", closed, now));
  }
  changes.push(stepChange("create", step, now));

  applyChangesAndNotify(changes);
  return c.json({ ok: true, step, closedSteps, closedStep: closedSteps.at(-1) ?? null, idempotent: false }, 201);
});

agentTracks.post("/tracks/:id/current-step/close", async (c) => {
  const trackId = c.req.param("id");
  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const parsed = closeStepSchema.safeParse(rawBody);
  if (!parsed.success) return c.json(invalidRequest(parsed.error.issues), 400);

  if (!getTrack(trackId)) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Track not found" } }, 404);

  const openSteps = listOpenSteps(trackId);
  if (openSteps.length === 0) return c.json({ ok: false, error: { code: "CONFLICT", message: "Track has no open step" } }, 409);

  const now = new Date().toISOString();
  const closedSteps = openSteps.map((openStep) => closeStep(openStep, parsed.data.endedAt ?? now, now));

  applyChangesAndNotify(closedSteps.map((closed) => stepChange("update", closed, now)));
  return c.json({ ok: true, closedSteps, closedStep: closedSteps.at(-1) ?? null });
});

agentTracks.patch("/tracks/:id", async (c) => {
  const id = c.req.param("id");
  const rawBody: unknown = await c.req.json().catch(() => null);
  const parsed = patchTrackSchema.safeParse(rawBody);
  if (!parsed.success) return c.json(invalidRequest(parsed.error.issues), 400);

  const current = getTrack(id);
  if (!current) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Track not found" } }, 404);

  const now = new Date().toISOString();
  const nextBase = {
    ...current,
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    ...(parsed.data.refs !== undefined ? { refs: parsed.data.refs } : {}),
    updatedAt: now,
  };
  const nextTrack = TrackSchema.parse(
    parsed.data.summary === null
      ? { ...nextBase, summary: undefined }
      : {
          ...nextBase,
          ...(parsed.data.summary !== undefined ? { summary: parsed.data.summary } : {}),
        },
  );

  const changes: SyncChange[] = [];
  let closedSteps: TrackStep[] = [];
  if (parsed.data.status === "concluded") {
    closedSteps = listOpenSteps(id).map((openStep) => closeStep(openStep, parsed.data.closedAt ?? now, now));
    for (const closed of closedSteps) {
      changes.push(stepChange("update", closed, now));
    }
  }
  changes.push(trackChange("update", nextTrack, now, trackStatusOp(current, nextTrack, now)));

  applyChangesAndNotify(changes);
  return c.json({ ok: true, track: nextTrack, closedSteps, closedStep: closedSteps.at(-1) ?? null });
});

export default agentTracks;
