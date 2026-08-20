// 轨道阶段骨架写入层：全部单事务 + syncLog。排序口径见 shared/trackMilestones（position 由本层重编号维护）。
import { orderMilestones, type TrackMilestone, TrackMilestoneSchema } from "@timedata/shared";
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
    const next = TrackMilestoneSchema.parse({
      ...parsedExisting,
      status: "dropped" as const,
      note: nextNote,
      updatedAt: timestamp,
    });
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

/** taskId → 挂靠里程碑。同一任务被多段挂靠时取排序在前者（与 UI 徽章仲裁同源）。 */
export function buildMilestoneTaskIndex(list: readonly TrackMilestone[]): Map<string, TrackMilestone> {
  const ordered = orderMilestones(list);
  const index = new Map<string, TrackMilestone>();
  for (const item of ordered) {
    if (item.status === "dropped") continue;
    const tid = item.taskId;
    if (tid === null) continue;
    if (!index.has(tid)) index.set(tid, item);
  }
  return index;
}

/** 搬移：把段插到 beforeId 之前（null=末尾），整轨道重编号。beforeId===id、目标段与本段不同轨道、任一不存在均 throw。 */
export async function moveMilestone(id: string, beforeId: string | null): Promise<TrackMilestone> {
  let result: TrackMilestone | null = null;
  await db.transaction("rw", db.tracks, db.trackMilestones, db.syncLog, async () => {
    const existing = await db.trackMilestones.get(id);
    if (!existing) throw new Error("里程碑不存在");
    const moved = TrackMilestoneSchema.parse(existing);
    if (beforeId !== null) {
      if (beforeId === id) throw new Error("里程碑不存在");
      const targetRow = await db.trackMilestones.get(beforeId);
      if (!targetRow) throw new Error("里程碑不存在");
      const target = TrackMilestoneSchema.parse(targetRow);
      if (target.trackId !== moved.trackId) throw new Error("目标段不在同一轨道");
    }
    const rows = await db.trackMilestones.where("trackId").equals(moved.trackId).toArray();
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
    const withoutMoved = ordered.filter((m) => m.id !== moved.id);
    let newOrdered: TrackMilestone[];
    if (beforeId === null) {
      const movedInOrdered = ordered.find((m) => m.id === moved.id) ?? moved;
      newOrdered = [...withoutMoved, movedInOrdered];
    } else {
      const idx = withoutMoved.findIndex((m) => m.id === beforeId);
      if (idx === -1) throw new Error("里程碑不存在");
      const movedInOrdered = ordered.find((m) => m.id === moved.id) ?? moved;
      newOrdered = [...withoutMoved];
      newOrdered.splice(idx, 0, movedInOrdered);
    }
    const timestamp = nowIso();
    for (let i = 0; i < newOrdered.length; i++) {
      const item = newOrdered[i];
      const isMoved = item.id === moved.id;
      if (isMoved) {
        const next = TrackMilestoneSchema.parse({ ...item, position: i, updatedAt: timestamp });
        await db.trackMilestones.put(next);
        await recordSyncLog("track_milestones", next.id, "update", timestamp);
        result = next;
      } else if (item.position !== i) {
        const next = TrackMilestoneSchema.parse({ ...item, position: i, updatedAt: timestamp });
        await db.trackMilestones.put(next);
        await recordSyncLog("track_milestones", next.id, "update", timestamp);
      }
    }
    if (!result) throw new Error("里程碑不存在");
  });
  if (!result) throw new Error("里程碑写入失败");
  return result;
}

/** 任务勾选镜像：查挂靠段（跳过 dropped），目标态 done?"done":"pending"，已一致不写。无挂靠返回 null。查写同事务，防两条勾选链交错读到未提交态。 */
export async function syncLinkedMilestoneOnTaskToggle(taskId: string, done: boolean): Promise<TrackMilestone | null> {
  let result: TrackMilestone | null = null;
  await db.transaction("rw", db.tracks, db.trackMilestones, db.syncLog, async () => {
    const rows = (await db.trackMilestones.where("taskId").equals(taskId).toArray()) as unknown as TrackMilestone[];
    const ordered = orderMilestones(rows);
    const target = ordered.find((m) => m.status !== "dropped");
    if (!target) {
      result = null;
      return;
    }
    const desired: TrackMilestone["status"] = done ? "done" : "pending";
    if (target.status === desired) {
      result = target;
      return;
    }
    result = await setMilestoneStatus(target.id, desired);
  });
  return result;
}
