import {
  TrackSchema,
  TrackStepSchema,
  compareTrackStepsBySemanticTime,
  listOpenSteps,
  trackStatusOp,
  type Ref,
  type Track,
  type TrackStep,
} from "@timedata/shared";
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

export type UserStepMode = "open" | "instant";

export interface PlanUserStepInput {
  trackId: string;
  id: string;
  content: string;
  mode: UserStepMode;
  tags: string[];
  timestamp: string;
}

export interface PlanUserStepResult {
  closed: TrackStep[];
  created: TrackStep;
}

export interface AppendUserStepInput {
  trackId: string;
  content: string;
  mode: UserStepMode;
  tags?: string[];
  now?: Date;
}

export interface SetTrackStatusResult {
  track: Track;
  closedSteps: TrackStep[];
}

function closeOpenStep(step: TrackStep, endedAt: string, updatedAt: string): TrackStep {
  const clampedEndedAt = endedAt < step.startedAt ? step.startedAt : endedAt;
  return TrackStepSchema.parse({ ...step, endedAt: clampedEndedAt, updatedAt });
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
    await recordSyncLog("tracks", next.id, "update", next.updatedAt, trackStatusOp(existing, next, next.updatedAt));
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

  const updatedAt = nowIso(patch.now);
  let candidate: TrackStep = {
    ...existing,
    refs: existing.refs ?? [],
    tags: existing.tags ?? [],
    updatedAt,
  };
  if (patch.content !== undefined) {
    if (patch.content !== existing.content) candidate.editedAt = updatedAt;
    candidate.content = patch.content;
  }
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

export function planUserStep(steps: TrackStep[], input: PlanUserStepInput): PlanUserStepResult {
  const seq = steps.reduce((max, step) => Math.max(max, step.seq + 1), 0);

  const closed =
    input.mode === "open" ? listOpenSteps(steps).map((open) => closeOpenStep(open, input.timestamp, input.timestamp)) : [];

  const created = TrackStepSchema.parse({
    id: input.id,
    trackId: input.trackId,
    source: "user",
    content: input.content,
    startedAt: input.timestamp,
    endedAt: input.mode === "open" ? null : input.timestamp,
    refs: [],
    tags: input.tags,
    seq,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  });

  return { closed, created };
}

export async function appendUserStep(input: AppendUserStepInput): Promise<PlanUserStepResult> {
  const timestamp = nowIso(input.now);
  const content = trimRequired(input.content, "步骤内容不能为空");
  let result: PlanUserStepResult | null = null;

  await db.transaction("rw", db.tracks, db.trackSteps, db.syncLog, async () => {
    const track = await db.tracks.get(input.trackId);
    if (!track) throw new Error("轨道不存在");
    const steps = (await db.trackSteps.where("trackId").equals(input.trackId).toArray()).map((row) =>
      TrackStepSchema.parse(row),
    );
    result = planUserStep(steps, {
      trackId: input.trackId,
      id: uuid(),
      content,
      mode: input.mode,
      tags: input.tags ?? [],
      timestamp,
    });
    for (const closed of result.closed) {
      await db.trackSteps.put(closed);
      await recordSyncLog("track_steps", closed.id, "update", timestamp);
    }
    await db.trackSteps.add(result.created);
    await recordSyncLog("track_steps", result.created.id, "create", timestamp);
  });

  if (!result) throw new Error("步骤写入失败");
  return result;
}

export async function closeCurrentStep(trackId: string, options?: { now?: Date }): Promise<TrackStep[]> {
  const timestamp = nowIso(options?.now);
  let closedSteps: TrackStep[] | null = null;

  await db.transaction("rw", db.tracks, db.trackSteps, db.syncLog, async () => {
    const track = await db.tracks.get(trackId);
    if (!track) throw new Error("轨道不存在");
    const steps = (await db.trackSteps.where("trackId").equals(trackId).toArray()).map((row) =>
      TrackStepSchema.parse(row),
    );
    const openSteps = listOpenSteps(steps);
    if (openSteps.length === 0) throw new Error("轨道没有进行中的步骤");
    closedSteps = openSteps.map((open) => closeOpenStep(open, timestamp, timestamp));
    for (const closed of closedSteps) {
      await db.trackSteps.put(closed);
      await recordSyncLog("track_steps", closed.id, "update", timestamp);
    }
  });

  if (!closedSteps) throw new Error("闭合失败");
  return closedSteps;
}

const STATUS_TRANSITION_LABEL: Record<Track["status"], string> = {
  active: "重新推进",
  concluded: "归档",
  parked: "搁置",
};

export async function setTrackStatus(
  trackId: string,
  status: Track["status"],
  options?: { now?: Date },
): Promise<SetTrackStatusResult> {
  const timestamp = nowIso(options?.now);
  let out: SetTrackStatusResult | null = null;

  await db.transaction("rw", db.tracks, db.trackSteps, db.syncLog, async () => {
    const existing = await db.tracks.get(trackId);
    if (!existing) throw new Error("轨道不存在");
    const steps = (await db.trackSteps.where("trackId").equals(trackId).toArray()).map((row) =>
      TrackStepSchema.parse(row),
    );

    let closedSteps: TrackStep[] = [];
    if (status === "concluded") {
      closedSteps = listOpenSteps(steps).map((open) => closeOpenStep(open, timestamp, timestamp));
      for (const closed of closedSteps) {
        await db.trackSteps.put(closed);
        await recordSyncLog("track_steps", closed.id, "update", timestamp);
      }
    }

    const next = TrackSchema.parse({ ...existing, refs: existing.refs ?? [], status, updatedAt: timestamp });
    await db.tracks.put(next);
    await recordSyncLog("tracks", next.id, "update", timestamp, trackStatusOp(existing, next, timestamp));

    // 状态变迁写一条 instant 系统步留痕（TK-18）：endedAt=startedAt，不计时、跨设备可见；仅状态真正改变时写。
    if (existing.status !== status) {
      const systemStep = TrackStepSchema.parse({
        id: uuid(),
        trackId,
        source: "user",
        content: STATUS_TRANSITION_LABEL[status],
        startedAt: timestamp,
        endedAt: timestamp,
        refs: [],
        tags: [],
        seq: steps.reduce((max, step) => Math.max(max, step.seq + 1), 0),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await db.trackSteps.add(systemStep);
      await recordSyncLog("track_steps", systemStep.id, "create", timestamp);
    }

    out = { track: next, closedSteps };
  });

  if (!out) throw new Error("状态更新失败");
  return out;
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

  return steps.sort(compareTrackStepsBySemanticTime);
}

export async function listAllTrackSteps(): Promise<TrackStep[]> {
  const rows = await db.trackSteps.toArray();
  const steps: TrackStep[] = [];
  for (const row of rows) {
    const parsed = TrackStepSchema.safeParse(row);
    if (!parsed.success) {
      warnInvalidTrackStep(row, parsed.error.issues);
      continue;
    }
    steps.push(parsed.data);
  }
  return steps.sort(compareTrackStepsBySemanticTime);
}

export async function deleteTrack(id: string): Promise<void> {
  await db.transaction("rw", db.tracks, db.trackSteps, db.syncLog, async () => {
    const steps = (await db.trackSteps.where("trackId").equals(id).toArray()).sort(compareTrackStepsBySemanticTime);
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
