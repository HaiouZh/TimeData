import { type Session, SessionSchema, type Task, TaskSchema, type Track, TrackSchema } from "@timedata/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import {
  endActiveSession,
  getActiveSession,
  grabTaskToHand,
  grabTrackToHand,
  healActiveSessions,
  listResumableSessions,
  releaseTaskFromHand,
  releaseTrackFromHand,
  resumeSession,
  updateSessionNote,
} from "./sessions.js";
import { moveTaskToParent } from "./tasks.js";

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

function makeTrack(overrides: Partial<Track> & { id: string }): Track {
  return TrackSchema.parse({
    title: `轨道${overrides.id}`,
    status: "active",
    refs: [],
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
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

  // 阶段3 起子任务可抓（五把锁之一）；重复模板与已跳过两条硬拒保留——
  // 它们拒的理由与 parentId 无关（规则不是可执行的活、跳过的发次已作废）。
  it("抓取校验：子任务可抓；重复模板 / skipped occurrence 仍 reject", async () => {
    await db.tasks.add(makeTask({ id: "child1", parentId: "root1" }));
    await db.tasks.add(makeTask({ id: "rule1", recurrence: { freq: "daily", interval: 1, basis: "due" } }));
    await db.tasks.add(makeTask({ id: "occ-skipped", ruleId: "rule1", skipped: true }));

    const grabbed = await grabTaskToHand("child1");
    expect(grabbed.sessionId).not.toBeNull();

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

    const logs = await db.syncLog
      .where("recordId")
      .equals(session?.id as string)
      .toArray();
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
    // 标题预览：按 sortOrder 前 3 条，匿名会话靠内容辨识主题
    const aTitles = all.find((r) => r.session.id === "s-a")?.pendingTitles ?? [];
    expect(aTitles).toHaveLength(2);
    expect(aTitles.every((t) => typeof t === "string" && t.length > 0)).toBe(true);

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

describe("updateSessionNote", () => {
  it("写入 note 并落 sessions 域 syncLog", async () => {
    await db.sessions.add(makeSession({ id: "s1", startedAt: "2026-07-28T08:00:00.000Z" }));

    const later = new Date("2026-07-28T09:00:00.000Z");
    const next = await updateSessionNote("s1", "先把周报弄完", { now: later });

    expect(next.note).toBe("先把周报弄完");
    expect(next.updatedAt).toBe(later.toISOString());
    const stored = await db.sessions.get("s1");
    expect(stored?.note).toBe("先把周报弄完");
    const logs = await db.syncLog.toArray();
    expect(logs.filter((l) => l.tableName === "sessions" && l.action === "update")).toHaveLength(1);
  });

  it("存入前 trim 首尾空白", async () => {
    await db.sessions.add(makeSession({ id: "s1", startedAt: "2026-07-28T08:00:00.000Z" }));

    const next = await updateSessionNote("s1", "  冲周报  ");
    expect(next.note).toBe("冲周报");
    expect((await db.sessions.get("s1"))?.note).toBe("冲周报");
  });

  it("trim 后空串归一为 null", async () => {
    await db.sessions.add(makeSession({ id: "s1", startedAt: "2026-07-28T08:00:00.000Z", note: "旧便签" }));

    const next = await updateSessionNote("s1", "   ");
    expect(next.note).toBeNull();
    expect((await db.sessions.get("s1"))?.note).toBeNull();
  });

  it("场不存在时 throw", async () => {
    await expect(updateSessionNote("missing", "x")).rejects.toThrow("会话不存在");
  });
});

describe("收纳后不重复计入续场统计", () => {
  it("被收纳成子任务的活不再算作本场未完", async () => {
    await db.tasks.add(makeTask({ id: "parent" }));
    await db.tasks.add(makeTask({ id: "child" }));
    await grabTaskToHand("parent");
    await grabTaskToHand("child");
    await endActiveSession();
    expect((await listResumableSessions())[0]?.pendingCount).toBe(2);

    await moveTaskToParent("child", "parent");

    expect((await listResumableSessions())[0]?.pendingCount).toBe(1);
  });
});

describe("grabTrackToHand", () => {
  it("无活跃场抓轨道 → 新场 created、trackIds=[id]、syncLog 1 create", async () => {
    await db.tracks.add(makeTrack({ id: "trk-1" }));
    const now = new Date("2026-07-24T08:00:00.000Z");

    const session = await grabTrackToHand("trk-1", { now });

    const stored = await db.sessions.get(session.id);
    expect(stored?.trackIds).toEqual(["trk-1"]);
    expect(session.trackIds).toEqual(["trk-1"]);
    expect(session.startedAt).toBe(now.toISOString());
    expect(stored?.endedAt).toBeNull();
    const logs = await db.syncLog.toArray();
    expect(logs.filter((l) => l.tableName === "sessions" && l.action === "create")).toHaveLength(1);
    expect(logs.filter((l) => l.tableName === "sessions")).toHaveLength(1);
  });

  it("已有活跃场抓 → 同场 trackIds 追加、syncLog 1 update", async () => {
    await db.tracks.bulkAdd([makeTrack({ id: "trk-1" }), makeTrack({ id: "trk-2" })]);
    const first = await grabTrackToHand("trk-1", { now: new Date("2026-07-24T08:00:00.000Z") });
    const beforeLogs = await db.syncLog.count();

    const second = await grabTrackToHand("trk-2", { now: new Date("2026-07-24T08:05:00.000Z") });

    expect(second.id).toBe(first.id);
    const stored = await db.sessions.get(first.id);
    expect(stored?.trackIds).toEqual(["trk-1", "trk-2"]);
    const afterLogs = await db.syncLog.toArray();
    expect(afterLogs.filter((l) => l.tableName === "sessions" && l.action === "update")).toHaveLength(1);
    expect(await db.syncLog.count()).toBe(beforeLogs + 1);
  });

  it("重复抓同轨道 → 幂等：trackIds 不重复、零新增 syncLog", async () => {
    await db.tracks.add(makeTrack({ id: "trk-1" }));
    const first = await grabTrackToHand("trk-1", { now: new Date("2026-07-24T08:00:00.000Z") });
    const countBefore = await db.syncLog.count();

    const second = await grabTrackToHand("trk-1", { now: new Date("2026-07-24T08:10:00.000Z") });

    expect(second.id).toBe(first.id);
    expect(second.trackIds).toEqual(["trk-1"]);
    const stored = await db.sessions.get(first.id);
    expect(stored?.trackIds).toEqual(["trk-1"]);
    expect(await db.syncLog.count()).toBe(countBefore);
  });

  it("track 不存在 → reject，无场被创建", async () => {
    const beforeSessions = await db.sessions.count();
    const beforeLogs = await db.syncLog.count();

    await expect(grabTrackToHand("missing")).rejects.toThrow();

    expect(await db.sessions.count()).toBe(beforeSessions);
    expect(await db.syncLog.count()).toBe(beforeLogs);
  });

  it("status=concluded / parked → reject，无场被创建", async () => {
    await db.tracks.bulkAdd([
      makeTrack({ id: "trk-c", status: "concluded" }),
      makeTrack({ id: "trk-p", status: "parked" }),
    ]);

    await expect(grabTrackToHand("trk-c")).rejects.toThrow();
    await expect(grabTrackToHand("trk-p")).rejects.toThrow();

    expect(await db.sessions.count()).toBe(0);
    expect(await db.syncLog.count()).toBe(0);
  });
});

describe("releaseTrackFromHand", () => {
  it("摘除 → trackIds 少一项、syncLog 1 update", async () => {
    await db.tracks.bulkAdd([makeTrack({ id: "trk-1" }), makeTrack({ id: "trk-2" })]);
    const session = await grabTrackToHand("trk-1", { now: new Date("2026-07-24T08:00:00.000Z") });
    await grabTrackToHand("trk-2", { now: new Date("2026-07-24T08:05:00.000Z") });
    const beforeLogs = await db.syncLog.count();

    const after = await releaseTrackFromHand("trk-1", { now: new Date("2026-07-24T08:10:00.000Z") });

    expect(after?.id).toBe(session.id);
    expect(after?.trackIds).toEqual(["trk-2"]);
    const stored = await db.sessions.get(session.id);
    expect(stored?.trackIds).toEqual(["trk-2"]);
    expect(await db.syncLog.count()).toBe(beforeLogs + 1);
    const logs = await db.syncLog.toArray();
    expect(logs.filter((l) => l.tableName === "sessions" && l.action === "update")).toHaveLength(2);
  });

  it("无活跃场或不含 id → no-op 零写", async () => {
    await db.tracks.add(makeTrack({ id: "trk-1" }));
    const beforeEmpty = await db.syncLog.count();
    const none = await releaseTrackFromHand("trk-1");
    expect(none).toBeNull();
    expect(await db.syncLog.count()).toBe(beforeEmpty);

    const session = await grabTrackToHand("trk-1", { now: new Date("2026-07-24T08:00:00.000Z") });
    await db.tracks.add(makeTrack({ id: "trk-2" }));
    const before = await db.syncLog.count();
    const same = await releaseTrackFromHand("trk-2");
    expect(same?.id).toBe(session.id);
    expect(same?.trackIds).toEqual(["trk-1"]);
    expect(await db.syncLog.count()).toBe(before);
  });
});

describe("endActiveSession 保留 trackIds", () => {
  it("散场后 trackIds 随场保留（读回归档场验证）", async () => {
    await db.tracks.bulkAdd([makeTrack({ id: "trk-1" }), makeTrack({ id: "trk-2" })]);
    const active = await grabTrackToHand("trk-1", { now: new Date("2026-07-24T08:00:00.000Z") });
    await grabTrackToHand("trk-2", { now: new Date("2026-07-24T08:05:00.000Z") });
    const later = new Date("2026-07-24T09:00:00.000Z");

    await endActiveSession({ now: later });

    const archived = await db.sessions.get(active.id);
    expect(archived?.endedAt).toBe(later.toISOString());
    expect(archived?.trackIds).toEqual(["trk-1", "trk-2"]);
    expect(await getActiveSession()).toBeNull();
  });
});

describe("releaseTrackFromHand 重复 id 一次全清（规格9）", () => {
  it("手工造 trackIds 含重复 a → releaseTrackFromHand('a') 后 []", async () => {
    // 直接写库制造重复 id 的活跃场（正常抓取不会产生重复，但语义应一次全清）
    const dupSession = makeSession({
      id: "s-dup",
      startedAt: "2026-07-24T08:00:00.000Z",
      trackIds: ["a", "a"],
    });
    await db.sessions.add(dupSession);
    const after = await releaseTrackFromHand("a", { now: new Date("2026-07-24T09:00:00.000Z") });
    expect(after?.trackIds).toEqual([]);
    const stored = await db.sessions.get("s-dup");
    expect(stored?.trackIds).toEqual([]);
  });
});
