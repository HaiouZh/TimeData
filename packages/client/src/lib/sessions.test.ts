import { SessionSchema, TaskSchema, type Session, type Task } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import {
  endActiveSession,
  getActiveSession,
  grabTaskToHand,
  healActiveSessions,
  listResumableSessions,
  releaseTaskFromHand,
  resumeSession,
} from "./sessions.js";

beforeEach(resetDb);

let taskSeq = 0;
function makeTask(overrides: Partial<Task> & { id: string }): Task {
  taskSeq += 1;
  return TaskSchema.parse({
    parentId: null,
    title: `任务${taskSeq}`,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [],
    ruleId: null,
    sessionId: null,
    skipped: false,
    sortOrder: taskSeq,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  });
}

function makeSession(overrides: Partial<Session> & { id: string; startedAt: string }): Session {
  return SessionSchema.parse({
    endedAt: null,
    note: null,
    createdAt: overrides.startedAt,
    updatedAt: overrides.startedAt,
    ...overrides,
  });
}

describe("grabTaskToHand", () => {
  it("空库抓任务：自动开场，sessions 恰 1 行，task.sessionId 指向新场，syncLog 各写 1 条", async () => {
    await db.tasks.add(makeTask({ id: "t1" }));
    const now = new Date("2026-07-24T08:00:00.000Z");

    const task = await grabTaskToHand("t1", { now });

    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].endedAt).toBeNull();
    expect(sessions[0].startedAt).toBe(now.toISOString());
    expect(task.sessionId).toBe(sessions[0].id);

    const logs = await db.syncLog.toArray();
    expect(logs.filter((l) => l.tableName === "sessions" && l.action === "create")).toHaveLength(1);
    expect(logs.filter((l) => l.tableName === "tasks" && l.action === "update")).toHaveLength(1);
  });

  it("已有活跃场再抓：不开新场，两任务同 sessionId", async () => {
    await db.tasks.add(makeTask({ id: "t1" }));
    await db.tasks.add(makeTask({ id: "t2" }));

    const first = await grabTaskToHand("t1", { now: new Date("2026-07-24T08:00:00.000Z") });
    const second = await grabTaskToHand("t2", { now: new Date("2026-07-24T08:05:00.000Z") });

    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.sessionId).toBe(sessions[0].id);
  });

  it("抓取校验：child / 重复模板 / skipped occurrence 均 reject", async () => {
    await db.tasks.add(makeTask({ id: "child1", parentId: "root1" }));
    await db.tasks.add(makeTask({ id: "rule1", recurrence: { freq: "daily", interval: 1, basis: "due" } }));
    await db.tasks.add(makeTask({ id: "occ-skipped", ruleId: "rule1", skipped: true }));

    await expect(grabTaskToHand("child1")).rejects.toThrow();
    await expect(grabTaskToHand("rule1")).rejects.toThrow();
    await expect(grabTaskToHand("occ-skipped")).rejects.toThrow();
  });
});

describe("releaseTaskFromHand", () => {
  it("移出：sessionId=null，会话行不动", async () => {
    await db.tasks.add(makeTask({ id: "t1" }));
    const grabbed = await grabTaskToHand("t1", { now: new Date("2026-07-24T08:00:00.000Z") });
    const sessionBefore = await db.sessions.get(grabbed.sessionId as string);

    const released = await releaseTaskFromHand("t1", { now: new Date("2026-07-24T08:10:00.000Z") });

    expect(released.sessionId).toBeNull();
    const sessionAfter = await db.sessions.get(sessionBefore?.id as string);
    expect(sessionAfter).toEqual(sessionBefore);
  });
});

describe("endActiveSession", () => {
  it("散场：session.endedAt=later，任务 sessionId 保留不变，syncLog 写 sessions/update", async () => {
    await db.tasks.add(makeTask({ id: "t1" }));
    const grabbed = await grabTaskToHand("t1", { now: new Date("2026-07-24T08:00:00.000Z") });
    const later = new Date("2026-07-24T09:00:00.000Z");

    await endActiveSession({ now: later });

    const session = await db.sessions.get(grabbed.sessionId as string);
    expect(session?.endedAt).toBe(later.toISOString());
    const task = await db.tasks.get("t1");
    expect(task?.sessionId).toBe(grabbed.sessionId);

    const logs = await db.syncLog.where("recordId").equals(session?.id as string).toArray();
    expect(logs.some((l) => l.tableName === "sessions" && l.action === "update")).toBe(true);
  });
});

describe("getActiveSession", () => {
  it("纯读：两行 endedAt null 取 startedAt 最大者，且不产生任何写", async () => {
    await db.sessions.bulkAdd([
      makeSession({ id: "s-early", startedAt: "2026-07-24T08:00:00.000Z" }),
      makeSession({ id: "s-late", startedAt: "2026-07-24T09:00:00.000Z" }),
    ]);

    const before = await db.syncLog.count();
    const active = await getActiveSession();
    const after = await db.syncLog.count();

    expect(active?.id).toBe("s-late");
    expect(after).toBe(before);
  });
});

describe("healActiveSessions", () => {
  it("单次收敛：早者补 endedAt，晚者仍 null；再 heal 一次零新写", async () => {
    await db.sessions.bulkAdd([
      makeSession({ id: "s-early", startedAt: "2026-07-24T08:00:00.000Z" }),
      makeSession({ id: "s-late", startedAt: "2026-07-24T09:00:00.000Z" }),
    ]);

    await healActiveSessions({ now: new Date("2026-07-24T10:00:00.000Z") });

    const afterFirst = await db.sessions.toArray();
    expect(afterFirst.find((s) => s.id === "s-late")?.endedAt).toBeNull();
    expect(afterFirst.find((s) => s.id === "s-early")?.endedAt).toBe("2026-07-24T10:00:00.000Z");

    const countAfterFirst = await db.syncLog.count();
    await healActiveSessions({ now: new Date("2026-07-24T11:00:00.000Z") });
    const countAfterSecond = await db.syncLog.count();

    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

describe("listResumableSessions", () => {
  it("过滤全完成/全skip 的场，未完成场按 endedAt 倒序，limit 生效", async () => {
    await db.sessions.bulkAdd([
      makeSession({ id: "s-a", startedAt: "2026-07-20T08:00:00.000Z", endedAt: "2026-07-20T09:00:00.000Z" }),
      makeSession({ id: "s-d", startedAt: "2026-07-22T08:00:00.000Z", endedAt: "2026-07-22T09:00:00.000Z" }),
      makeSession({ id: "s-b", startedAt: "2026-07-21T08:00:00.000Z", endedAt: "2026-07-21T09:00:00.000Z" }),
      makeSession({ id: "s-c", startedAt: "2026-07-23T08:00:00.000Z", endedAt: "2026-07-23T09:00:00.000Z" }),
    ]);
    await db.tasks.bulkAdd([
      makeTask({ id: "a1", sessionId: "s-a", done: false }),
      makeTask({ id: "a2", sessionId: "s-a", done: false }),
      makeTask({ id: "d1", sessionId: "s-d", done: false }),
      makeTask({ id: "b1", sessionId: "s-b", done: true }),
      makeTask({ id: "b2", sessionId: "s-b", done: true }),
      makeTask({ id: "c1", sessionId: "s-c", skipped: true }),
    ]);

    const all = await listResumableSessions();
    expect(all.map((r) => r.session.id)).toEqual(["s-d", "s-a"]);
    expect(all.find((r) => r.session.id === "s-a")?.pendingCount).toBe(2);
    expect(all.find((r) => r.session.id === "s-d")?.pendingCount).toBe(1);

    const limited = await listResumableSessions(1);
    expect(limited.map((r) => r.session.id)).toEqual(["s-d"]);
  });
});

describe("resumeSession", () => {
  it("续场迁移：散当前活跃场→开新场→旧场未完批量改指新场，done 留旧场归属，旧场从 resumable 消失", async () => {
    await db.sessions.bulkAdd([
      makeSession({ id: "s-y", startedAt: "2026-07-24T07:00:00.000Z" }),
      makeSession({ id: "s-x", startedAt: "2026-07-23T07:00:00.000Z", endedAt: "2026-07-23T08:00:00.000Z" }),
    ]);
    await db.tasks.bulkAdd([
      makeTask({ id: "t1", sessionId: "s-x", done: false }),
      makeTask({ id: "t2", sessionId: "s-x", done: true }),
    ]);

    const now = new Date("2026-07-24T09:00:00.000Z");
    const resumed = await resumeSession("s-x", { now });

    expect(resumed.id).not.toBe("s-y");
    expect(resumed.id).not.toBe("s-x");
    expect(resumed.endedAt).toBeNull();
    expect(resumed.startedAt).toBe(now.toISOString());

    const yAfter = await db.sessions.get("s-y");
    expect(yAfter?.endedAt).toBe(now.toISOString());

    const xAfter = await db.sessions.get("s-x");
    expect(xAfter?.endedAt).toBe("2026-07-23T08:00:00.000Z");

    const t1After = await db.tasks.get("t1");
    const t2After = await db.tasks.get("t2");
    expect(t1After?.sessionId).toBe(resumed.id);
    expect(t2After?.sessionId).toBe("s-x");

    const resumable = await listResumableSessions();
    expect(resumable.some((r) => r.session.id === "s-x")).toBe(false);
  });

  it("对活跃场自身幂等 no-op：传入的 sessionId 恰是当前活跃场时不新建场、不迁移、零写", async () => {
    await db.tasks.add(makeTask({ id: "t1" }));
    const grabbed = await grabTaskToHand("t1", { now: new Date("2026-07-24T08:00:00.000Z") });
    const activeId = grabbed.sessionId as string;

    const before = await db.syncLog.count();
    const resumed = await resumeSession(activeId, { now: new Date("2026-07-24T09:00:00.000Z") });
    const after = await db.syncLog.count();

    expect(resumed.id).toBe(activeId);
    expect(after).toBe(before);

    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].endedAt).toBeNull();

    const task = await db.tasks.get("t1");
    expect(task?.sessionId).toBe(activeId);
  });
});
