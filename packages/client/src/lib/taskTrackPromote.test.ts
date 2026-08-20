import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { addTask, toggleTaskDone, updateTask } from "./tasks.js";
import { addTrack, listTrackSteps, setTrackStatus } from "./tracks.js";
import { addMilestones, dropMilestone, linkMilestoneTask } from "./trackMilestones.js";
import type { Track } from "@timedata/shared";
import {
  buildTrackConcludeUndo,
  promoteTaskToTrack,
  toggleTaskDoneWithTrackConclude,
  undoToggleWithTrackConclude,
} from "./taskTrackPromote.js";

beforeEach(resetDb);

describe("promoteTaskToTrack", () => {
  it("建 active 轨道：标题复用、refs 指回任务（label=标题）、不写任何步骤（光板零仪式感）", async () => {
    const task = await addTask({ title: "长跑活" });
    const track = await promoteTaskToTrack(task);
    expect(track.status).toBe("active");
    expect(track.title).toBe("长跑活");
    expect(track.refs).toEqual([{ kind: "task", id: task.id, label: "长跑活" }]);
    expect(await db.tracks.get(track.id)).toBeTruthy();
    expect(await listTrackSteps(track.id)).toHaveLength(0);
  });

  it("幂等：已挂 active 轨道时返回既有轨道，不重建", async () => {
    const task = await addTask({ title: "活" });
    const first = await promoteTaskToTrack(task);
    const second = await promoteTaskToTrack(task);
    expect(second.id).toBe(first.id);
    expect(await db.tracks.count()).toBe(1);
  });

  it("旧轨道已归档后可再升一条新轨道", async () => {
    const task = await addTask({ title: "活" });
    const first = await promoteTaskToTrack(task);
    await setTrackStatus(first.id, "concluded");
    const second = await promoteTaskToTrack(task);
    expect(second.id).not.toBe(first.id);
    expect(await db.tracks.count()).toBe(2);
  });

  it("超长标题的 ref label 截到 200 字符（RefSchema 上限），标题本身不截", async () => {
    const long = "长".repeat(300);
    const task = await addTask({ title: long });
    const track = await promoteTaskToTrack(task);
    expect(track.title).toBe(long);
    expect(track.refs[0]?.label?.length).toBe(200);
  });
});

describe("toggleTaskDoneWithTrackConclude", () => {
  it("勾掉挂轨道的任务 → 轨道自动 concluded 并写归档系统步，且交出 concludedTrack", async () => {
    const task = await addTask({ title: "活" });
    const track = await promoteTaskToTrack(task);
    const { task: next, concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    expect(next.done).toBe(true);
    expect((await db.tracks.get(track.id))?.status).toBe("concluded");
    const steps = await listTrackSteps(track.id);
    expect(steps.some((s) => s.content === "归档")).toBe(true);
    // 返回值是撤销 toast 的唯一依据：归档真发生了才非 null，且必须是那条轨道。
    expect(concludedTrack?.id).toBe(track.id);
    expect(concludedTrack?.status).toBe("concluded");
  });

  it("取消勾选不自动重开轨道（单向联动），concludedTrack 为 null", async () => {
    const task = await addTask({ title: "活" });
    const track = await promoteTaskToTrack(task);
    await toggleTaskDoneWithTrackConclude(task.id);
    const { task: reopened, concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    expect(reopened.done).toBe(false);
    expect((await db.tracks.get(track.id))?.status).toBe("concluded");
    expect(concludedTrack).toBeNull();
  });

  it("取消勾选时轨道已被手动重开 → 不再次归档（单向早退的真闸：无早退会误归档 active 轨道）", async () => {
    const task = await addTask({ title: "活" });
    const track = await promoteTaskToTrack(task);
    await toggleTaskDoneWithTrackConclude(task.id);
    await setTrackStatus(track.id, "active");
    const { task: reopened, concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    expect(reopened.done).toBe(false);
    expect((await db.tracks.get(track.id))?.status).toBe("active");
    expect(concludedTrack).toBeNull();
  });

  it("没挂轨道的任务：行为与 toggleTaskDone 一致，不碰 tracks 表，concludedTrack 为 null", async () => {
    const task = await addTask({ title: "小活" });
    const { task: next, concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    expect(next.done).toBe(true);
    expect(await db.tracks.count()).toBe(0);
    expect(concludedTrack).toBeNull();
  });

  it("轨道非 active（手动已归档）不再联动", async () => {
    const task = await addTask({ title: "活" });
    const track = await promoteTaskToTrack(task);
    const { track: concluded } = await setTrackStatus(track.id, "concluded");
    const { concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    // 原探针（数「归档」步条数）是假闸：setTrackStatus 对状态未变的轨道不写系统步，误联动
    // 也不会产生第二条步。改 pin updatedAt：误联动会再走一次 setTrackStatus 写库 bump 它。
    expect((await db.tracks.get(track.id))?.updatedAt).toBe(concluded.updatedAt);
    expect(concludedTrack).toBeNull();
  });

  it("任务升格后补加重复规则：勾规则根代理完成一发，不归档轨道（next.id 承重钉，回归成入参 id 会在此红）", async () => {
    const task = await addTask({ title: "养成活" });
    const track = await promoteTaskToTrack(task);
    await updateTask(task.id, { recurrence: { freq: "daily", interval: 1, basis: "due" } });
    const { task: next, concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    // 完成被代理到 occurrence（next.id ≠ 入参 id），轨道 refs 指的是规则本体——查不到即不归档。
    // design §四明文：勾一发就归档轨道、下一发又光板，是坑。
    expect(next.id).not.toBe(task.id);
    expect(next.done).toBe(true);
    expect((await db.tracks.get(track.id))?.status).toBe("active");
    expect(concludedTrack).toBeNull();
  });

  it("别的轨道（refs 不指向本任务）不受影响", async () => {
    const task = await addTask({ title: "活" });
    const other = await addTrack({ title: "无关轨道" });
    await toggleTaskDoneWithTrackConclude(task.id);
    expect((await db.tracks.get(other.id))?.status).toBe("active");
  });
});

describe("undoToggleWithTrackConclude", () => {
  it("撤销是完整回退：任务回到未完成 + 轨道重开 active", async () => {
    const task = await addTask({ title: "手滑勾掉的活" });
    const track = await promoteTaskToTrack(task);
    const { task: done, concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    expect(done.done).toBe(true);
    expect(concludedTrack).not.toBeNull();

    await undoToggleWithTrackConclude(done.id, (concludedTrack as Track).id);
    expect((await db.tasks.get(done.id))?.done).toBe(false);
    expect((await db.tracks.get(track.id))?.status).toBe("active");
  });

  // 提示存活 6 秒，期间用户完全可能自己先取消了勾选，再回头点撤销。
  // toggleTaskDone 是**翻转**——无条件调它会把任务反向勾成已完成，与「撤销 = 回退」相反。
  it("撤销时任务已被自己取消勾选 → 不把它反向勾成已完成，只重开轨道", async () => {
    const task = await addTask({ title: "先勾后悔又手动取消的活" });
    const track = await promoteTaskToTrack(task);
    const { task: done, concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    // 用户没点撤销，而是自己又取消勾选一次（单向联动：这次不会重开轨道、也不弹新提示，旧提示还在）。
    await toggleTaskDoneWithTrackConclude(done.id);
    expect((await db.tasks.get(done.id))?.done).toBe(false);

    // 此刻点旧提示上的「撤销」。
    await undoToggleWithTrackConclude(done.id, (concludedTrack as Track).id);
    expect((await db.tasks.get(done.id))?.done).toBe(false);
    expect((await db.tracks.get(track.id))?.status).toBe("active");
  });

  it("撤销回退里程碑镜像：勾选时段被镜像成 done，撤销后段归位 pending", async () => {
    const task = await addTask({ title: "撤销镜像活" });
    const track = await addTrack({ title: "T-undo-milestone" });
    const milestones = await addMilestones(track.id, ["第一阶段", "第二阶段"]);
    await linkMilestoneTask(milestones[1].id, task.id);
    // 挂轨道用于归档校验（与里程碑无关，复用既有 promote 能力）
    const promoted = await promoteTaskToTrack(task);
    const { task: done, concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    expect(done.done).toBe(true);
    expect((await db.trackMilestones.get(milestones[1].id))?.status).toBe("done");
    expect(concludedTrack?.id).toBe(promoted.id);

    await undoToggleWithTrackConclude(done.id, (concludedTrack as Track).id);

    expect((await db.tasks.get(done.id))?.done).toBe(false);
    expect((await db.tracks.get(promoted.id))?.status).toBe("active");
    expect((await db.trackMilestones.get(milestones[1].id))?.status).toBe("pending");
  });

  it("撤销无条件回退里程碑：用户先直调 toggleTaskDone 取消勾选后，撤销仍把段归位 pending", async () => {
    const task = await addTask({ title: "撤销无条件镜像活" });
    const track = await addTrack({ title: "T-undo-milestone-2" });
    const milestones = await addMilestones(track.id, ["第一阶段", "第二阶段"]);
    await linkMilestoneTask(milestones[1].id, task.id);
    const promoted = await promoteTaskToTrack(task);
    const { task: done, concludedTrack } = await toggleTaskDoneWithTrackConclude(task.id);
    expect((await db.trackMilestones.get(milestones[1].id))?.status).toBe("done");
    // 用户没点撤销，而是直调 toggleTaskDone 取消勾选（绕过镜像，段仍停在 done）
    await toggleTaskDone(done.id);
    expect((await db.tasks.get(done.id))?.done).toBe(false);
    expect((await db.trackMilestones.get(milestones[1].id))?.status).toBe("done");

    await undoToggleWithTrackConclude(done.id, (concludedTrack as Track).id);

    expect((await db.tasks.get(done.id))?.done).toBe(false);
    expect((await db.trackMilestones.get(milestones[1].id))?.status).toBe("pending");
  });
});

describe("buildTrackConcludeUndo", () => {
  it("没真归档（concludedTrack 为 null）时返回 null", async () => {
    const task = await addTask({ title: "小活" });
    const result = await toggleTaskDoneWithTrackConclude(task.id);
    expect(buildTrackConcludeUndo(result)).toBeNull();
  });

  it("真归档时 message 是全串「已归档轨道「<轨道标题>」」（中文标题逐字断言）", async () => {
    const task = await addTask({ title: "中文标题活" });
    const track = await promoteTaskToTrack(task);
    const result = await toggleTaskDoneWithTrackConclude(task.id);
    const undoState = buildTrackConcludeUndo(result);
    expect(undoState).not.toBeNull();
    expect(undoState?.message).toBe(`已归档轨道「${track.title}」`);
  });

  it("onUndo() 以 (task.id, concludedTrack.id) 完整回退：任务回未完成 + 轨道重开 active", async () => {
    const task = await addTask({ title: "手滑勾掉的活" });
    const track = await promoteTaskToTrack(task);
    const result = await toggleTaskDoneWithTrackConclude(task.id);
    const undoState = buildTrackConcludeUndo(result);
    expect(undoState).not.toBeNull();

    // 参数传错任何一边，对应的效果都不会发生（轨道不重开 / 任务不回未完成），效果断言即参数断言。
    await undoState!.onUndo();
    expect((await db.tasks.get(task.id))?.done).toBe(false);
    expect((await db.tracks.get(track.id))?.status).toBe("active");
  });
});

describe("toggleTaskDoneWithTrackConclude 里程碑镜像", () => {
  it("建轨道+两段骨架，第二段挂任务；勾掉任务 → 该段 status=done", async () => {
    const task = await addTask({ title: "里程碑任务" });
    const track = await addTrack({ title: "T-milestone" });
    const milestones = await addMilestones(track.id, ["第一阶段", "第二阶段"]);
    await linkMilestoneTask(milestones[1].id, task.id);

    const { task: next } = await toggleTaskDoneWithTrackConclude(task.id);

    expect(next.done).toBe(true);
    const linked = await db.trackMilestones.get(milestones[1].id);
    expect(linked?.status).toBe("done");
    const first = await db.trackMilestones.get(milestones[0].id);
    expect(first?.status).toBe("pending");
  });

  it("再次取消勾选 → 翻回 pending（守 early-return 之前执行）", async () => {
    const task = await addTask({ title: "里程碑任务" });
    const track = await addTrack({ title: "T-milestone" });
    const milestones = await addMilestones(track.id, ["第一阶段", "第二阶段"]);
    await linkMilestoneTask(milestones[1].id, task.id);

    await toggleTaskDoneWithTrackConclude(task.id);
    expect((await db.trackMilestones.get(milestones[1].id))?.status).toBe("done");

    const { task: reopened } = await toggleTaskDoneWithTrackConclude(task.id);
    expect(reopened.done).toBe(false);
    expect((await db.trackMilestones.get(milestones[1].id))?.status).toBe("pending");
  });

  it("挂靠段是 dropped 时勾任务不改它", async () => {
    const task = await addTask({ title: "里程碑任务" });
    const track = await addTrack({ title: "T-milestone" });
    const milestones = await addMilestones(track.id, ["第一阶段", "第二阶段"]);
    await linkMilestoneTask(milestones[1].id, task.id);
    await dropMilestone(milestones[1].id, "砍掉");

    await toggleTaskDoneWithTrackConclude(task.id);

    expect((await db.trackMilestones.get(milestones[1].id))?.status).toBe("dropped");
  });

  it("镜像路径抛错时 task.done 照常翻转、console.warn 被调、函数不 throw", async () => {
    const task = await addTask({ title: "里程碑任务" });
    const track = await addTrack({ title: "T-milestone" });
    const milestones = await addMilestones(track.id, ["第一阶段", "第二阶段"]);
    await linkMilestoneTask(milestones[1].id, task.id);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const whereSpy = vi.spyOn(db.trackMilestones, "where").mockImplementation(((..._args: unknown[]) => ({
      equals: () => ({
        toArray: () => Promise.reject(new Error("boom")),
      }),
    })) as unknown as typeof db.trackMilestones.where);

    let result: Awaited<ReturnType<typeof toggleTaskDoneWithTrackConclude>> | null = null;
    let threw = false;
    try {
      result = await toggleTaskDoneWithTrackConclude(task.id);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result?.task.done).toBe(true);
    expect((await db.tasks.get(task.id))?.done).toBe(true);
    expect(warn).toHaveBeenCalled();
    // 轨道联动仍独立：没挂 refs 轨道自然为 null，但不应因前面的 warn 而崩
    expect(result?.concludedTrack).toBeNull();

    warn.mockRestore();
    whereSpy.mockRestore();
  });
});
