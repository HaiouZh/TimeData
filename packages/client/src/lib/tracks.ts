import { TrackSchema, TrackStepSchema, type Ref, type Track, type TrackStep } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";

export interface AddTrackInput {
  title: string;
  summary?: string;
  status?: Track["status"];
  refs?: Ref[];
  now?: Date;
}

export interface UpdateTrackPatch {
  title?: string;
  summary?: string | null;
  status?: Track["status"];
  refs?: Ref[];
  now?: Date;
}

export interface AddTrackStepInput {
  trackId: string;
  source: TrackStep["source"];
  sourceLabel?: string;
  content: string;
  startedAt: string;
  endedAt?: string | null;
  refs?: Ref[];
  tags?: string[];
  seq?: number;
  now?: Date;
}

export interface UpdateTrackStepPatch {
  sourceLabel?: string | null;
  content?: string;
  startedAt?: string;
  endedAt?: string | null;
  refs?: Ref[];
  tags?: string[];
  seq?: number;
  now?: Date;
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function trimRequired(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

async function nextStepSeq(trackId: string): Promise<number> {
  const steps = await db.trackSteps.where("trackId").equals(trackId).toArray();
  return steps.reduce((max, step) => Math.max(max, step.seq + 1), 0);
}

function byTrackStepOrder(a: TrackStep, b: TrackStep): number {
  return a.seq - b.seq || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id);
}

function warnInvalidTrack(row: unknown, issues: unknown): void {
  const id = typeof row === "object" && row !== null && "id" in row ? String(row.id) : "?";
  console.warn(`[tracks] dropping invalid local track ${id}:`, issues);
}

function warnInvalidTrackStep(row: unknown, issues: unknown): void {
  const id = typeof row === "object" && row !== null && "id" in row ? String(row.id) : "?";
  console.warn(`[tracks] dropping invalid local track step ${id}:`, issues);
}

function omitTrackSummary(track: Track): Track {
  const { summary: _summary, ...rest } = track;
  return rest;
}

function omitTrackStepSourceLabel(step: TrackStep): TrackStep {
  const { sourceLabel: _sourceLabel, ...rest } = step;
  return rest;
}

export async function addTrack(input: AddTrackInput): Promise<Track> {
  const createdAt = nowIso(input.now);
  const candidate = {
    id: uuid(),
    title: trimRequired(input.title, "轨道标题不能为空"),
    status: input.status ?? "active",
    refs: input.refs ?? [],
    createdAt,
    updatedAt: createdAt,
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
  };
  const track = TrackSchema.parse(candidate);

  await db.transaction("rw", db.tracks, db.syncLog, async () => {
    await db.tracks.add(track);
    await recordSyncLog("tracks", track.id, "create", track.updatedAt);
  });

  return track;
}

export async function updateTrack(id: string, patch: UpdateTrackPatch): Promise<Track> {
  const existing = await db.tracks.get(id);
  if (!existing) throw new Error("轨道不存在");

  let candidate: Track = { ...existing, refs: existing.refs ?? [], updatedAt: nowIso(patch.now) };
  if (patch.title !== undefined) candidate.title = trimRequired(patch.title, "轨道标题不能为空");
  if (patch.status !== undefined) candidate.status = patch.status;
  if (patch.refs !== undefined) candidate.refs = patch.refs;
  if (patch.summary === null) {
    candidate = omitTrackSummary(candidate);
  } else if (patch.summary !== undefined) {
    candidate.summary = patch.summary;
  }

  const next = TrackSchema.parse(candidate);
  await db.transaction("rw", db.tracks, db.syncLog, async () => {
    await db.tracks.put(next);
    await recordSyncLog("tracks", next.id, "update", next.updatedAt);
  });

  return next;
}

export async function addTrackStep(input: AddTrackStepInput): Promise<TrackStep> {
  const track = await db.tracks.get(input.trackId);
  if (!track) throw new Error("轨道不存在");

  const createdAt = nowIso(input.now);
  const candidate = {
    id: uuid(),
    trackId: input.trackId,
    source: input.source,
    content: input.content,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    refs: input.refs ?? [],
    tags: input.tags ?? [],
    seq: input.seq ?? (await nextStepSeq(input.trackId)),
    createdAt,
    updatedAt: createdAt,
    ...(input.sourceLabel !== undefined ? { sourceLabel: input.sourceLabel } : {}),
  };
  const step = TrackStepSchema.parse(candidate);

  await db.transaction("rw", db.trackSteps, db.syncLog, async () => {
    await db.trackSteps.add(step);
    await recordSyncLog("track_steps", step.id, "create", step.updatedAt);
  });

  return step;
}

export async function updateTrackStep(id: string, patch: UpdateTrackStepPatch): Promise<TrackStep> {
  const existing = await db.trackSteps.get(id);
  if (!existing) throw new Error("轨道步骤不存在");

  let candidate: TrackStep = {
    ...existing,
    refs: existing.refs ?? [],
    tags: existing.tags ?? [],
    updatedAt: nowIso(patch.now),
  };
  if (patch.content !== undefined) candidate.content = patch.content;
  if (patch.startedAt !== undefined) candidate.startedAt = patch.startedAt;
  if (patch.endedAt !== undefined) candidate.endedAt = patch.endedAt;
  if (patch.refs !== undefined) candidate.refs = patch.refs;
  if (patch.tags !== undefined) candidate.tags = patch.tags;
  if (patch.seq !== undefined) candidate.seq = patch.seq;
  if (patch.sourceLabel === null) {
    candidate = omitTrackStepSourceLabel(candidate);
  } else if (patch.sourceLabel !== undefined) {
    candidate.sourceLabel = patch.sourceLabel;
  }

  const next = TrackStepSchema.parse(candidate);
  await db.transaction("rw", db.trackSteps, db.syncLog, async () => {
    await db.trackSteps.put(next);
    await recordSyncLog("track_steps", next.id, "update", next.updatedAt);
  });

  return next;
}

export async function getTrack(id: string): Promise<Track | undefined> {
  const row = await db.tracks.get(id);
  if (!row) return undefined;
  const parsed = TrackSchema.safeParse(row);
  if (!parsed.success) return undefined;
  return parsed.data;
}

export async function listTracks(status?: Track["status"]): Promise<Track[]> {
  const rows = status ? await db.tracks.where("status").equals(status).toArray() : await db.tracks.toArray();
  const tracks: Track[] = [];

  for (const row of rows) {
    const parsed = TrackSchema.safeParse(row);
    if (!parsed.success) {
      warnInvalidTrack(row, parsed.error.issues);
      continue;
    }
    tracks.push(parsed.data);
  }

  return tracks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

export async function listTrackSteps(trackId: string): Promise<TrackStep[]> {
  const rows = await db.trackSteps.where("trackId").equals(trackId).toArray();
  const steps: TrackStep[] = [];

  for (const row of rows) {
    const parsed = TrackStepSchema.safeParse(row);
    if (!parsed.success) {
      warnInvalidTrackStep(row, parsed.error.issues);
      continue;
    }
    steps.push(parsed.data);
  }

  return steps.sort(byTrackStepOrder);
}

export async function deleteTrack(id: string): Promise<void> {
  await db.transaction("rw", db.tracks, db.trackSteps, db.syncLog, async () => {
    const steps = (await db.trackSteps.where("trackId").equals(id).toArray()).sort(byTrackStepOrder);
    await db.trackSteps.bulkDelete(steps.map((step) => step.id));
    for (const step of steps) {
      await recordSyncLog("track_steps", step.id, "delete");
    }
    await db.tracks.delete(id);
    await recordSyncLog("tracks", id, "delete");
  });
}

export async function deleteTrackStep(id: string): Promise<void> {
  await db.transaction("rw", db.trackSteps, db.syncLog, async () => {
    await db.trackSteps.delete(id);
    await recordSyncLog("track_steps", id, "delete");
  });
}
