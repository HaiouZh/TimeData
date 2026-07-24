import { SessionSchema, TaskSchema } from "@timedata/shared";
import type { Session, Task } from "@timedata/shared";
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

/** 抓活到手头：无活跃场自动零仪式开场；仅 root 且非重复规则、非 skipped 的任务可抓。 */
export async function grabTaskToHand(taskId: string, options: { now?: Date } = {}): Promise<Task> {
  const ts = nowIso(options.now);
  return db.transaction("rw", db.sessions, db.tasks, db.syncLog, async () => {
    const existing = await db.tasks.get(taskId);
    if (!existing) throw new Error("任务不存在");
    if ((existing.parentId ?? null) !== null) throw new Error("子任务不能单独抓到手头");
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

export interface ResumableSession {
  session: Session;
  pendingCount: number;
}

/** 已散且仍有未完任务的场，endedAt 倒序取前 limit 个（续场入口数据源）。 */
export async function listResumableSessions(limit = 5): Promise<ResumableSession[]> {
  const closed = (await db.sessions.filter((s) => s.endedAt !== null).toArray()) as Session[];
  const result: ResumableSession[] = [];
  for (const session of closed) {
    const pendingCount = await db.tasks
      .where("sessionId")
      .equals(session.id)
      .filter((t) => !t.done && !t.skipped)
      .count();
    if (pendingCount > 0) result.push({ session, pendingCount });
  }
  return result
    .sort((a, b) => (b.session.endedAt ?? "").localeCompare(a.session.endedAt ?? ""))
    .slice(0, limit);
}

/** 续场 = 散当前活跃场 → 开新场 → 旧场未完任务批量改指新场（done 留旧场，旧场归档不可变）。 */
export async function resumeSession(sessionId: string, options: { now?: Date } = {}): Promise<Session> {
  const ts = nowIso(options.now);
  return db.transaction("rw", db.sessions, db.tasks, db.syncLog, async () => {
    const source = await db.sessions.get(sessionId);
    if (!source) throw new Error("会话不存在");

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
