// 轨道阶段骨架写入层：全部单事务 + syncLog。排序口径见 shared/trackMilestones（position 由本层重编号维护）。
import { TrackMilestoneSchema, orderMilestones, type TrackMilestone } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";

function nowIso(): string {
  return new Date().toISOString();
}

function trimRequired(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function warnInvalidMilestone(row: unknown, issues: unknown): void {
  const id = typeof row === "object" && row !== null && "id" in row ? String((row as { id: unknown }).id) : "?";
  console.warn(`[trackMilestones] dropping invalid local track milestone ${id}:`, issues);
}

export async function listTrackMilestones(trackId: string): Promise<TrackMilestone[]> {
  const rows = await db.trackMilestones.where("trackId").equals(trackId).toArray();
  const milestones: TrackMilestone[] = [];
  for (const row of rows) {
    const parsed = TrackMilestoneSchema.safeParse(row);
    if (!parsed.success) {
      warnInvalidMilestone(row, parsed.error.issues);
      continue;
    }
    milestones.push(parsed.data);
  }
  return orderMilestones(milestones);
}

export async function addMilestones(trackId: string, titles: string[]): Promise<TrackMilestone[]> {
  let created: TrackMilestone[] = [];
  await db.transaction("rw", db.tracks, db.trackMilestones, db.syncLog, async () => {
    const track = await db.tracks.get(trackId);
    if (!track) throw new Error("轨道不存在");
    const trimmedTitles = titles.map((t) => trimRequired(t, "里程碑标题不能为空"));
    const existing = await db.trackMilestones.where("trackId").equals(trackId).toArray();
    const maxPosition = existing.reduce((max, m) => Math.max(max, m.position), -1);
    const timestamp = nowIso();
    const nextMilestones: TrackMilestone[] = [];
    for (let i = 0; i < trimmedTitles.length; i++) {
      const title = trimmedTitles[i];
      const candidate = {
        id: uuid(),
        trackId,
        title,
        status: "pending" as const,
        note: null,
        taskId: null,
        position: maxPosition + 1 + i,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const milestone = TrackMilestoneSchema.parse(candidate);
      await db.trackMilestones.add(milestone);
      await recordSyncLog("track_milestones", milestone.id, "create", timestamp);
      nextMilestones.push(milestone);
    }
    created = nextMilestones;
  });
  return created;
}

export async function insertMilestoneAt(trackId: string, title: string, beforeId?: string): Promise<TrackMilestone> {
  const trimmedTitle = trimRequired(title, "里程碑标题不能为空");
  let created: TrackMilestone | null = null;
  await db.transaction("rw", db.tracks, db.trackMilestones, db.syncLog, async () => {
    const track = await db.tracks.get(trackId);
    if (!track) throw new Error("轨道不存在");
    const rows = await db.trackMilestones.where("trackId").equals(trackId).toArray();
    const parsedRows: TrackMilestone[] = [];
    for (const row of rows) {
      const parsed = TrackMilestoneSchema.safeParse(row);
      if (!parsed.success) {
        warnInvalidMilestone(row, parsed.error.issues);
        continue;
      }
      parsedRows.push(parsed.data);
    }
    const ordered = orderMilestones(parsedRows);
    let insertIndex: number;
    if (beforeId === undefined) {
      insertIndex = ordered.length;
    } else {
      const idx = ordered.findIndex((m) => m.id === beforeId);
      if (idx === -1) throw new Error("里程碑不存在");
      insertIndex = idx;
    }
    const timestamp = nowIso();
    const candidate = {
      id: uuid(),
      trackId,
      title: trimmedTitle,
      status: "pending" as const,
      note: null,
      taskId: null,
      position: insertIndex,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const milestone = TrackMilestoneSchema.parse(candidate);
    const newOrdered = [...ordered];
    newOrdered.splice(insertIndex, 0, milestone);
    // 先落新段
    await db.trackMilestones.add(milestone);
    await recordSyncLog("track_milestones", milestone.id, "create", timestamp);
    created = milestone;
    // 重编号既有行
    for (let i = 0; i < newOrdered.length; i++) {
      const item = newOrdered[i];
      if (item.id === milestone.id) continue;
      if (item.position !== i) {
        const next = TrackMilestoneSchema.parse({ ...item, position: i, updatedAt: timestamp });
        await db.trackMilestones.put(next);
        await recordSyncLog("track_milestones", next.id, "update", timestamp);
      }
    }
  });
  if (!created) throw new Error("里程碑写入失败");
  return created;
}

export async function updateMilestoneTitle(id: string, title: string): Promise<TrackMilestone> {
  const trimmed = trimRequired(title, "里程碑标题不能为空");
  let updated: TrackMilestone | null = null;
  await db.transaction("rw", db.tracks, db.trackMilestones, db.syncLog, async () => {
    const existing = await db.trackMilestones.get(id);
    if (!existing) throw new Error("里程碑不存在");
    const parsedExisting = TrackMilestoneSchema.parse(existing);
    const timestamp = nowIso();
    const next = TrackMilestoneSchema.parse({ ...parsedExisting, title: trimmed, updatedAt: timestamp });
    await db.trackMilestones.put(next);
    await recordSyncLog("track_milestones", next.id, "update", timestamp);
    updated = next;
  });
  if (!updated) throw new Error("里程碑写入失败");
  return updated;
}

export async function setMilestoneStatus(id: string, status: TrackMilestone["status"]): Promise<TrackMilestone> {
  let updated: TrackMilestone | null = null;
  await db.transaction("rw", db.tracks, db.trackMilestones, db.syncLog, async () => {
    const existing = await db.trackMilestones.get(id);
    if (!existing) throw new Error("里程碑不存在");
    const parsedExisting = TrackMilestoneSchema.parse(existing);
    const timestamp = nowIso();
    const next = TrackMilestoneSchema.parse({ ...parsedExisting, status, updatedAt: timestamp });
    await db.trackMilestones.put(next);
    await recordSyncLog("track_milestones", next.id, "update", timestamp);
    updated = next;
  });
  if (!updated) throw new Error("里程碑写入失败");
  return updated;
}

export async function dropMilestone(id: string, note?: string): Promise<TrackMilestone> {
  let updated: TrackMilestone | null = null;
  await db.transaction("rw", db.tracks, db.trackMilestones, db.syncLog, async () => {
    const existing = await db.trackMilestones.get(id);
    if (!existing) throw new Error("里程碑不存在");
    const parsedExisting = TrackMilestoneSchema.parse(existing);
    const timestamp = nowIso();
    let nextNote: string | null = parsedExisting.note;
    if (note !== undefined) {
      const trimmed = note.trim();
      if (trimmed) nextNote = trimmed;
    }
    const next = TrackMilestoneSchema.parse({ ...parsedExisting, status: "dropped" as const, note: nextNote, updatedAt: timestamp });
    await db.trackMilestones.put(next);
    await recordSyncLog("track_milestones", next.id, "update", timestamp);
    updated = next;
  });
  if (!updated) throw new Error("里程碑写入失败");
  return updated;
}

export async function linkMilestoneTask(id: string, taskId: string): Promise<TrackMilestone> {
  const trimmedTaskId = trimRequired(taskId, "任务不存在");
  let updated: TrackMilestone | null = null;
  await db.transaction("rw", db.tracks, db.trackMilestones, db.syncLog, async () => {
    const existing = await db.trackMilestones.get(id);
    if (!existing) throw new Error("里程碑不存在");
    const parsedExisting = TrackMilestoneSchema.parse(existing);
    const timestamp = nowIso();
    const next = TrackMilestoneSchema.parse({ ...parsedExisting, taskId: trimmedTaskId, updatedAt: timestamp });
    await db.trackMilestones.put(next);
    await recordSyncLog("track_milestones", next.id, "update", timestamp);
    updated = next;
  });
  if (!updated) throw new Error("里程碑写入失败");
  return updated;
}

export async function unlinkMilestoneTask(id: string): Promise<TrackMilestone> {
  let updated: TrackMilestone | null = null;
  await db.transaction("rw", db.tracks, db.trackMilestones, db.syncLog, async () => {
    const existing = await db.trackMilestones.get(id);
    if (!existing) throw new Error("里程碑不存在");
    const parsedExisting = TrackMilestoneSchema.parse(existing);
    const timestamp = nowIso();
    const next = TrackMilestoneSchema.parse({ ...parsedExisting, taskId: null, updatedAt: timestamp });
    await db.trackMilestones.put(next);
    await recordSyncLog("track_milestones", next.id, "update", timestamp);
    updated = next;
  });
  if (!updated) throw new Error("里程碑写入失败");
  return updated;
}
