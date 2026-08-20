import type { TrackMilestone } from "@timedata/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../test/dbReset.js";
import { addTrack } from "./tracks.js";
import {
  addMilestones,
  buildMilestoneTaskIndex,
  insertMilestoneAt,
  listTrackMilestones,
  dropMilestone,
  setMilestoneStatus,
  syncLinkedMilestoneOnTaskToggle,
  updateMilestoneTitle,
  linkMilestoneTask,
  unlinkMilestoneTask,
} from "./trackMilestones.js";

const now = new Date("2026-06-21T08:00:00.000Z");

beforeEach(async () => {
  await db.tracks.clear();
  await db.trackMilestones.clear();
  await db.trackSteps.clear();
  await db.syncLog.clear();
});

describe("trackMilestones 写入层", () => {
  it("addMilestones 批量建两段：position 0/1、status 全 pending、note/taskId null、syncLog 两条 create", async () => {
    const track = await addTrack({ title: "T1", now });
    await db.syncLog.clear();

    const milestones = await addMilestones(track.id, ["  第一阶段  ", "第二阶段"]);

    expect(milestones).toHaveLength(2);
    expect(milestones[0]).toMatchObject({
      trackId: track.id,
      title: "第一阶段",
      position: 0,
      status: "pending",
      note: null,
      taskId: null,
    });
    expect(milestones[1]).toMatchObject({
      trackId: track.id,
      title: "第二阶段",
      position: 1,
      status: "pending",
      note: null,
      taskId: null,
    });
    // 持久化校验
    const stored = await db.trackMilestones.where("trackId").equals(track.id).toArray();
    expect(stored).toHaveLength(2);
    // syncLog
    const logs = await db.syncLog.where("tableName").equals("track_milestones").toArray();
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.action === "create")).toBe(true);
    expect(logs.every((l) => l.tableName === "track_milestones")).toBe(true);
    // 时间戳与行一致
    for (const m of milestones) {
      const log = logs.find((l) => l.recordId === m.id);
      expect(log?.timestamp).toBe(m.updatedAt);
    }
  });

  it("insertMilestoneAt(trackId, \"新段\", 第一段id)：新段 position 0，原两段重编号 1/2；syncLog = 1 create + 2 update", async () => {
    const track = await addTrack({ title: "T1", now });
    const initial = await addMilestones(track.id, ["第一阶段", "第二阶段"]);
    await db.syncLog.clear();

    const inserted = await insertMilestoneAt(track.id, "新段", initial[0].id);

    expect(inserted.title).toBe("新段");
    expect(inserted.position).toBe(0);
    expect(inserted.trackId).toBe(track.id);

    const listed = await listTrackMilestones(track.id);
    expect(listed.map((m) => m.title)).toEqual(["新段", "第一阶段", "第二阶段"]);
    expect(listed.map((m) => m.position)).toEqual([0, 1, 2]);

    const logs = await db.syncLog.where("tableName").equals("track_milestones").toArray();
    expect(logs.filter((l) => l.action === "create")).toHaveLength(1);
    expect(logs.filter((l) => l.action === "update")).toHaveLength(2);
    expect(logs).toHaveLength(3);
    // 新段为 create
    expect(logs.find((l) => l.recordId === inserted.id)?.action).toBe("create");
    // 原两段为 update
    expect(logs.find((l) => l.recordId === initial[0].id)?.action).toBe("update");
    expect(logs.find((l) => l.recordId === initial[1].id)?.action).toBe("update");
  });

  it("insertMilestoneAt 不传 beforeId：追加末尾，只 1 create、既有行零 update", async () => {
    const track = await addTrack({ title: "T1", now });
    const initial = await addMilestones(track.id, ["第一阶段", "第二阶段"]);
    await db.syncLog.clear();

    const inserted = await insertMilestoneAt(track.id, "末尾段");

    expect(inserted.position).toBe(2);
    const listed = await listTrackMilestones(track.id);
    expect(listed.map((m) => m.title)).toEqual(["第一阶段", "第二阶段", "末尾段"]);
    expect(listed.map((m) => m.position)).toEqual([0, 1, 2]);

    const logs = await db.syncLog.where("tableName").equals("track_milestones").toArray();
    expect(logs.filter((l) => l.action === "create")).toHaveLength(1);
    expect(logs.filter((l) => l.action === "update")).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0].recordId).toBe(inserted.id);
  });

  it("updateMilestoneTitle 只改 title，position 不变", async () => {
    const track = await addTrack({ title: "T1", now });
    const [m1] = await addMilestones(track.id, ["旧标题"]);
    await db.syncLog.clear();

    const updated = await updateMilestoneTitle(m1.id, "  新标题  ");

    expect(updated.title).toBe("新标题");
    expect(updated.position).toBe(m1.position);
    expect(updated.trackId).toBe(track.id);
    const stored = await db.trackMilestones.get(m1.id);
    expect(stored?.title).toBe("新标题");
    expect(stored?.position).toBe(0);

    const logs = await db.syncLog.where("recordId").equals(m1.id).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ tableName: "track_milestones", action: "update" });
    expect(logs[0].timestamp).toBe(updated.updatedAt);
  });

  it("dropMilestone(id, \"转 ideas，买账号后复活\")：status=dropped、note 落库、行还在（不物理删）", async () => {
    const track = await addTrack({ title: "T1", now });
    const [m1] = await addMilestones(track.id, ["待砍"]);
    await db.syncLog.clear();

    const dropped = await dropMilestone(m1.id, "转 ideas，买账号后复活");

    expect(dropped.status).toBe("dropped");
    expect(dropped.note).toBe("转 ideas，买账号后复活");
    expect(dropped.id).toBe(m1.id);
    const stored = await db.trackMilestones.get(m1.id);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe("dropped");
    expect(stored?.note).toBe("转 ideas，买账号后复活");

    const logs = await db.syncLog.where("recordId").equals(m1.id).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ tableName: "track_milestones", action: "update" });
  });

  it("setMilestoneStatus(droppedId, \"pending\")：翻回 pending、note 保留", async () => {
    const track = await addTrack({ title: "T1", now });
    const [m1] = await addMilestones(track.id, ["待砍"]);
    const dropped = await dropMilestone(m1.id, "转 ideas，买账号后复活");
    await db.syncLog.clear();

    const revived = await setMilestoneStatus(dropped.id, "pending");

    expect(revived.status).toBe("pending");
    expect(revived.note).toBe("转 ideas，买账号后复活");
    const stored = await db.trackMilestones.get(m1.id);
    expect(stored?.status).toBe("pending");
    expect(stored?.note).toBe("转 ideas，买账号后复活");

    const logs = await db.syncLog.where("recordId").equals(m1.id).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ tableName: "track_milestones", action: "update" });
  });

  it("linkMilestoneTask 写 taskId", async () => {
    const track = await addTrack({ title: "T1", now });
    const [m1] = await addMilestones(track.id, ["需挂任务"]);
    await db.syncLog.clear();

    const linked = await linkMilestoneTask(m1.id, "task-123");

    expect(linked.taskId).toBe("task-123");
    const stored = await db.trackMilestones.get(m1.id);
    expect(stored?.taskId).toBe("task-123");

    const logs = await db.syncLog.where("recordId").equals(m1.id).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ tableName: "track_milestones", action: "update" });
  });

  it("unlinkMilestoneTask 清 taskId", async () => {
    const track = await addTrack({ title: "T1", now });
    const [m1] = await addMilestones(track.id, ["需挂任务"]);
    await linkMilestoneTask(m1.id, "task-123");
    await db.syncLog.clear();

    const unlinked = await unlinkMilestoneTask(m1.id);

    expect(unlinked.taskId).toBeNull();
    const stored = await db.trackMilestones.get(m1.id);
    expect(stored?.taskId).toBeNull();

    const logs = await db.syncLog.where("recordId").equals(m1.id).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ tableName: "track_milestones", action: "update" });
  });

  it("宿主轨道不存在时 addMilestones reject", async () => {
    await expect(addMilestones("missing-track", ["标题"])).rejects.toThrow();
    const count = await db.trackMilestones.count();
    expect(count).toBe(0);
    const logs = await db.syncLog.where("tableName").equals("track_milestones").toArray();
    expect(logs).toHaveLength(0);
  });

  it("listTrackMilestones 返回按 (position, createdAt, id) 升序", async () => {
    const track = await addTrack({ title: "T1", now });
    // 直接写库构造乱序数据
    const t0 = "2026-08-20T00:00:00.000Z";
    const t1 = "2026-08-20T00:00:01.000Z";
    const t2 = "2026-08-20T00:00:02.000Z";
    await db.trackMilestones.bulkAdd([
      {
        id: "m2",
        trackId: track.id,
        title: "第二",
        status: "pending",
        note: null,
        taskId: null,
        position: 1,
        createdAt: t2,
        updatedAt: t2,
      },
      {
        id: "m0",
        trackId: track.id,
        title: "第一",
        status: "pending",
        note: null,
        taskId: null,
        position: 0,
        createdAt: t1,
        updatedAt: t1,
      },
      {
        id: "m1a",
        trackId: track.id,
        title: "同位早",
        status: "pending",
        note: null,
        taskId: null,
        position: 1,
        createdAt: t0,
        updatedAt: t0,
      },
      {
        id: "m1b",
        trackId: track.id,
        title: "同位晚",
        status: "pending",
        note: null,
        taskId: null,
        position: 1,
        createdAt: t1,
        updatedAt: t1,
      },
    ] as TrackMilestone[]);

    const listed = await listTrackMilestones(track.id);
    expect(listed.map((m) => m.id)).toEqual(["m0", "m1a", "m1b", "m2"]);
  });

  it("addMilestones 空标题拒、insertMilestoneAt beforeId 找不到 throw", async () => {
    const track = await addTrack({ title: "T1", now });
    await expect(addMilestones(track.id, ["  ", "有效"])).rejects.toThrow();
    await expect(addMilestones(track.id, [""])).rejects.toThrow();
    const [m1] = await addMilestones(track.id, ["有效"]);
    await expect(insertMilestoneAt(track.id, "新段", "missing-id")).rejects.toThrow();
    await expect(updateMilestoneTitle("missing-id", "标题")).rejects.toThrow();
    await expect(setMilestoneStatus("missing-id", "done")).rejects.toThrow();
    await expect(dropMilestone("missing-id")).rejects.toThrow();
    await expect(linkMilestoneTask("missing-id", "task-1")).rejects.toThrow();
    await expect(unlinkMilestoneTask("missing-id")).rejects.toThrow();
  });

  it("listTrackMilestones 坏行 console.warn 跳过", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const track = await addTrack({ title: "T1", now });
    await addMilestones(track.id, ["正常"]);
    // 插入坏行
    await db.trackMilestones.put({
      id: "bad",
      trackId: track.id,
      title: "",
      status: "pending",
      note: null,
      taskId: null,
      position: 99,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    } as unknown as TrackMilestone);

    const listed = await listTrackMilestones(track.id);
    expect(listed.length).toBe(1);
    expect(listed[0].title).toBe("正常");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("addMilestones 追加到非空轨道时 position 从 max+1 续接（2/3）", async () => {
    const track = await addTrack({ title: "T1", now });
    const firstTwo = await addMilestones(track.id, ["第一段", "第二段"]);
    expect(firstTwo.map((m) => m.position)).toEqual([0, 1]);

    const nextTwo = await addMilestones(track.id, ["第三段", "第四段"]);

    expect(nextTwo).toHaveLength(2);
    expect(nextTwo[0].position).toBe(2);
    expect(nextTwo[1].position).toBe(3);
    expect(nextTwo[0].title).toBe("第三段");
    expect(nextTwo[1].title).toBe("第四段");

    const listed = await listTrackMilestones(track.id);
    expect(listed.map((m) => m.title)).toEqual(["第一段", "第二段", "第三段", "第四段"]);
    expect(listed.map((m) => m.position)).toEqual([0, 1, 2, 3]);
  });

  it("dropMilestone 空白 note 时保留原备注", async () => {
    const track = await addTrack({ title: "T1", now });
    const [m1] = await addMilestones(track.id, ["待砍"]);
    // 先铺底原备注
    const droppedOnce = await dropMilestone(m1.id, "原备注");
    expect(droppedOnce.note).toBe("原备注");
    // 翻回 pending 保留备注（借 setMilestoneStatus 的既有语义）
    const revived = await setMilestoneStatus(m1.id, "pending");
    expect(revived.note).toBe("原备注");
    expect(revived.status).toBe("pending");

    const droppedBlank = await dropMilestone(m1.id, "   ");

    expect(droppedBlank.status).toBe("dropped");
    expect(droppedBlank.note).toBe("原备注");
    const stored = await db.trackMilestones.get(m1.id);
    expect(stored?.status).toBe("dropped");
    expect(stored?.note).toBe("原备注");
  });
});

describe("buildMilestoneTaskIndex", () => {
  it("同一任务被两段挂靠时取 position 小者", () => {
    const list: TrackMilestone[] = [
      {
        id: "m2",
        trackId: "t1",
        title: "第二",
        status: "pending",
        note: null,
        taskId: "task-1",
        position: 1,
        createdAt: "2026-06-21T08:00:01.000Z",
        updatedAt: "2026-06-21T08:00:01.000Z",
      },
      {
        id: "m1",
        trackId: "t1",
        title: "第一",
        status: "pending",
        note: null,
        taskId: "task-1",
        position: 0,
        createdAt: "2026-06-21T08:00:00.000Z",
        updatedAt: "2026-06-21T08:00:00.000Z",
      },
      {
        id: "m3",
        trackId: "t1",
        title: "第三",
        status: "pending",
        note: null,
        taskId: "task-2",
        position: 2,
        createdAt: "2026-06-21T08:00:02.000Z",
        updatedAt: "2026-06-21T08:00:02.000Z",
      },
    ];
    const index = buildMilestoneTaskIndex(list);
    expect(index.size).toBe(2);
    expect(index.get("task-1")?.id).toBe("m1");
    expect(index.get("task-2")?.id).toBe("m3");
  });

  it("dropped 的段不进索引", () => {
    const list: TrackMilestone[] = [
      {
        id: "m1",
        trackId: "t1",
        title: "被砍",
        status: "dropped",
        note: null,
        taskId: "task-1",
        position: 0,
        createdAt: "2026-06-21T08:00:00.000Z",
        updatedAt: "2026-06-21T08:00:00.000Z",
      },
      {
        id: "m2",
        trackId: "t1",
        title: "正常",
        status: "pending",
        note: null,
        taskId: "task-2",
        position: 1,
        createdAt: "2026-06-21T08:00:01.000Z",
        updatedAt: "2026-06-21T08:00:01.000Z",
      },
      {
        id: "m3",
        trackId: "t1",
        title: "无挂靠",
        status: "pending",
        note: null,
        taskId: null,
        position: 2,
        createdAt: "2026-06-21T08:00:02.000Z",
        updatedAt: "2026-06-21T08:00:02.000Z",
      },
    ];
    const index = buildMilestoneTaskIndex(list);
    expect(index.has("task-1")).toBe(false);
    expect(index.get("task-2")?.id).toBe("m2");
    expect(index.size).toBe(1);
  });

  it("同位时按 createdAt/id 仲裁，position 小者仍胜", () => {
    const list: TrackMilestone[] = [
      {
        id: "m2",
        trackId: "t1",
        title: "后",
        status: "pending",
        note: null,
        taskId: "task-1",
        position: 0,
        createdAt: "2026-06-21T08:00:01.000Z",
        updatedAt: "2026-06-21T08:00:01.000Z",
      },
      {
        id: "m1",
        trackId: "t1",
        title: "前",
        status: "pending",
        note: null,
        taskId: "task-1",
        position: 0,
        createdAt: "2026-06-21T08:00:00.000Z",
        updatedAt: "2026-06-21T08:00:00.000Z",
      },
    ];
    const index = buildMilestoneTaskIndex(list);
    expect(index.get("task-1")?.id).toBe("m1");
  });
});

describe("syncLinkedMilestoneOnTaskToggle", () => {
  it("目标态一致时不产生新 syncLog 条目（幂等）", async () => {
    const track = await addTrack({ title: "T1", now });
    const [m1] = await addMilestones(track.id, ["阶段一"]);
    await linkMilestoneTask(m1.id, "task-123");
    await setMilestoneStatus(m1.id, "done");
    await db.syncLog.clear();
    const before = await db.syncLog.where("tableName").equals("track_milestones").toArray();
    expect(before).toHaveLength(0);

    const result = await syncLinkedMilestoneOnTaskToggle("task-123", true);

    expect(result?.id).toBe(m1.id);
    expect(result?.status).toBe("done");
    const after = await db.syncLog.where("tableName").equals("track_milestones").toArray();
    expect(after).toHaveLength(0);
    const stored = await db.trackMilestones.get(m1.id);
    expect(stored?.status).toBe("done");
  });

  it("无挂靠时返回 null，不写库", async () => {
    const result = await syncLinkedMilestoneOnTaskToggle("missing-task", true);
    expect(result).toBeNull();
    const logs = await db.syncLog.where("tableName").equals("track_milestones").toArray();
    expect(logs).toHaveLength(0);
  });
});
