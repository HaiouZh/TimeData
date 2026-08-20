import type { Session, Task } from "@timedata/shared";
import { SessionSchema, TaskSchema } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function pickActive(rows: Session[]): Session | null {
  const open = rows.filter((s) => s.endedAt === null);
  if (open.length === 0) return null;
  return open.reduce((a, b) => (a.startedAt > b.startedAt || (a.startedAt === b.startedAt && a.id > b.id) ? a : b));
}

/** 纯读：活跃场 = endedAt null 中 startedAt 最大者（并发残留多行时取最新，不写库）。 */
export async function getActiveSession(): Promise<Session | null> {
  const rows = (await db.sessions.toArray()).flatMap((row) => {
    const parsed = SessionSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  return pickActive(rows);
}

/** 显式自愈：跨设备并发开场残留的多行 null，把非最新者补 endedAt。收敛后再调零写。 */
export async function healActiveSessions(options: { now?: Date } = {}): Promise<void> {
  const ts = nowIso(options.now);
  await db.transaction("rw", db.sessions, db.syncLog, async () => {
    const rows = await db.sessions.filter((s) => s.endedAt === null).toArray();
    if (rows.length <= 1) return;
    const active = pickActive(rows as Session[]);
    for (const row of rows) {
      if (row.id === active?.id) continue;
      const next = SessionSchema.parse({ ...row, endedAt: ts, updatedAt: ts });
      await db.sessions.put(next);
      await recordSyncLog("sessions", next.id, "update", ts);
    }
  });
}

async function putTaskSessionId(taskId: string, sessionId: string | null, ts: string): Promise<Task> {
  const existing = await db.tasks.get(taskId);
  if (!existing) throw new Error("任务不存在");
  const next = TaskSchema.parse({ ...existing, sessionId, updatedAt: ts });
  await db.tasks.put(next);
  await recordSyncLog("tasks", next.id, "update", ts);
  return next;
}

/** 抓活到手头：无活跃场自动零仪式开场；非重复规则、非 skipped 的任务可抓。阶段3 起子任务同样可抓。 */
export async function grabTaskToHand(taskId: string, options: { now?: Date } = {}): Promise<Task> {
  const ts = nowIso(options.now);
  return db.transaction("rw", db.sessions, db.tasks, db.syncLog, async () => {
    const existing = await db.tasks.get(taskId);
    if (!existing) throw new Error("任务不存在");
    if (existing.recurrence !== null) throw new Error("重复规则不能抓到手头");
    if (existing.skipped) throw new Error("已跳过的任务不能抓到手头");

    let active = await getActiveSession();
    if (!active) {
      active = SessionSchema.parse({ id: uuid(), startedAt: ts, createdAt: ts, updatedAt: ts });
      await db.sessions.add(active);
      await recordSyncLog("sessions", active.id, "create", ts);
    }
    return putTaskSessionId(taskId, active.id, ts);
  });
}

/** 移出手头：只解绑指针，会话行不动。 */
export async function releaseTaskFromHand(taskId: string, options: { now?: Date } = {}): Promise<Task> {
  const ts = nowIso(options.now);
  return db.transaction("rw", db.tasks, db.syncLog, async () => putTaskSessionId(taskId, null, ts));
}

/** 抓轨道到手头：track 须存在且 active；无活跃场零仪式开场；幂等（已在场内不重写）。返回活跃场。 */
export async function grabTrackToHand(trackId: string, options: { now?: Date } = {}): Promise<Session> {
  const ts = nowIso(options.now);
  return db.transaction("rw", db.sessions, db.tracks, db.syncLog, async () => {
    const track = await db.tracks.get(trackId);
    if (!track) throw new Error("轨道不存在");
    if (track.status !== "active") throw new Error("只有进行中的轨道可以抓到手头");

    let active = await getActiveSession();
    if (!active) {
      active = SessionSchema.parse({ id: uuid(), startedAt: ts, createdAt: ts, updatedAt: ts, trackIds: [trackId] });
      await db.sessions.add(active);
      await recordSyncLog("sessions", active.id, "create", ts);
      return active;
    }
    const ids = active.trackIds ?? [];
    if (ids.includes(trackId)) return active;
    const next = SessionSchema.parse({ ...active, trackIds: [...ids, trackId], updatedAt: ts });
    await db.sessions.put(next);
    await recordSyncLog("sessions", next.id, "update", ts);
    return next;
  });
}

/** 移出手头：从活跃场 trackIds 摘除。无活跃场或不含该 id 时 no-op 返回当前活跃场（可能 null）。 */
export async function releaseTrackFromHand(trackId: string, options: { now?: Date } = {}): Promise<Session | null> {
  const ts = nowIso(options.now);
  return db.transaction("rw", db.sessions, db.tracks, db.syncLog, async () => {
    const active = await getActiveSession();
    if (!active) return null;
    const ids = active.trackIds ?? [];
    if (!ids.includes(trackId)) return active;
    const next = SessionSchema.parse({ ...active, trackIds: ids.filter((id) => id !== trackId), updatedAt: ts });
    await db.sessions.put(next);
    await recordSyncLog("sessions", next.id, "update", ts);
    return next;
  });
}

/** 散场：只落会话行 endedAt，任务行（含 sessionId）一律不动——历史归属靠 sessionId 保留还原。 */
export async function endActiveSession(options: { now?: Date } = {}): Promise<void> {
  const ts = nowIso(options.now);
  await db.transaction("rw", db.sessions, db.syncLog, async () => {
    const active = await getActiveSession();
    if (!active) return;
    const next = SessionSchema.parse({ ...active, endedAt: ts, updatedAt: ts });
    await db.sessions.put(next);
    await recordSyncLog("sessions", next.id, "update", ts);
  });
}

/** 场便签：trim 后空串归一 null；普通 sessions 域 update，散场不清、随场归档。 */
export async function updateSessionNote(
  sessionId: string,
  note: string | null,
  options: { now?: Date } = {},
): Promise<Session> {
  const ts = nowIso(options.now);
  return db.transaction("rw", db.sessions, db.syncLog, async () => {
    const existing = await db.sessions.get(sessionId);
    if (!existing) throw new Error("会话不存在");
    const trimmed = note?.trim() ?? "";
    const next = SessionSchema.parse({ ...existing, note: trimmed === "" ? null : trimmed, updatedAt: ts });
    await db.sessions.put(next);
    await recordSyncLog("sessions", next.id, "update", ts);
    return next;
  });
}

export interface ResumableSession {
  session: Session;
  pendingCount: number;
  /** 未完任务标题预览（按 sortOrder 前 3 条）：匿名会话靠内容辨识主题，续场行展示用。 */
  pendingTitles: string[];
}

/** 已散且仍有未完任务的场，endedAt 倒序取前 limit 个（续场入口数据源）。 */
export async function listResumableSessions(limit = 5): Promise<ResumableSession[]> {
  const closed = (await db.sessions.filter((s) => s.endedAt !== null).toArray()) as Session[];
  const result: ResumableSession[] = [];
  for (const session of closed) {
    const pending = await db.tasks
      .where("sessionId")
      .equals(session.id)
      .filter((t) => !t.done && !t.skipped)
      .toArray();
    if (pending.length > 0) {
      result.push({
        session,
        pendingCount: pending.length,
        pendingTitles: pending
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .slice(0, 3)
          .map((t) => t.title),
      });
    }
  }
  return result.sort((a, b) => (b.session.endedAt ?? "").localeCompare(a.session.endedAt ?? "")).slice(0, limit);
}

/**
 * 续场 = 散当前活跃场 → 开新场 → 旧场未完任务批量改指新场（done 留旧场，旧场归档不可变）。
 * 若传入的 sessionId 恰是当前活跃场自身（跨设备竞态下持有 stale 可续列表），幂等 no-op：
 * 不散场、不建新场、不迁移、零写，直接返回原场——避免产生双活跃僵尸场；多 null 残留交 healActiveSessions 收敛。
 */
export async function resumeSession(sessionId: string, options: { now?: Date } = {}): Promise<Session> {
  const ts = nowIso(options.now);
  return db.transaction("rw", db.sessions, db.tasks, db.syncLog, async () => {
    const source = await db.sessions.get(sessionId);
    if (!source) throw new Error("会话不存在");
    if (source.endedAt === null) return SessionSchema.parse(source);

    const active = await getActiveSession();
    if (active && active.id !== sessionId) {
      const closed = SessionSchema.parse({ ...active, endedAt: ts, updatedAt: ts });
      await db.sessions.put(closed);
      await recordSyncLog("sessions", closed.id, "update", ts);
    }

    const fresh = SessionSchema.parse({ id: uuid(), startedAt: ts, createdAt: ts, updatedAt: ts });
    await db.sessions.add(fresh);
    await recordSyncLog("sessions", fresh.id, "create", ts);

    const pending = await db.tasks
      .where("sessionId")
      .equals(sessionId)
      .filter((t) => !t.done && !t.skipped)
      .toArray();
    for (const task of pending) {
      await putTaskSessionId(task.id, fresh.id, ts);
    }
    return fresh;
  });
}
