import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { addTask, updateTask } from "./tasks.js";
import { addTrack, listTrackSteps, setTrackStatus } from "./tracks.js";
import { promoteTaskToTrack, toggleTaskDoneWithTrackConclude } from "./taskTrackPromote.js";

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
  it("勾掉挂轨道的任务 → 轨道自动 concluded 并写归档系统步", async () => {
    const task = await addTask({ title: "活" });
    const track = await promoteTaskToTrack(task);
    const next = await toggleTaskDoneWithTrackConclude(task.id);
    expect(next.done).toBe(true);
    expect((await db.tracks.get(track.id))?.status).toBe("concluded");
    const steps = await listTrackSteps(track.id);
    expect(steps.some((s) => s.content === "归档")).toBe(true);
  });

  it("取消勾选不自动重开轨道（单向联动）", async () => {
    const task = await addTask({ title: "活" });
    const track = await promoteTaskToTrack(task);
    await toggleTaskDoneWithTrackConclude(task.id);
    const reopened = await toggleTaskDoneWithTrackConclude(task.id);
    expect(reopened.done).toBe(false);
    expect((await db.tracks.get(track.id))?.status).toBe("concluded");
  });

  it("取消勾选时轨道已被手动重开 → 不再次归档（单向早退的真闸：无早退会误归档 active 轨道）", async () => {
    const task = await addTask({ title: "活" });
    const track = await promoteTaskToTrack(task);
    await toggleTaskDoneWithTrackConclude(task.id);
    await setTrackStatus(track.id, "active");
    const reopened = await toggleTaskDoneWithTrackConclude(task.id);
    expect(reopened.done).toBe(false);
    expect((await db.tracks.get(track.id))?.status).toBe("active");
  });

  it("没挂轨道的任务：行为与 toggleTaskDone 一致，不碰 tracks 表", async () => {
    const task = await addTask({ title: "小活" });
    const next = await toggleTaskDoneWithTrackConclude(task.id);
    expect(next.done).toBe(true);
    expect(await db.tracks.count()).toBe(0);
  });

  it("轨道非 active（手动已归档）不再联动", async () => {
    const task = await addTask({ title: "活" });
    const track = await promoteTaskToTrack(task);
    const { track: concluded } = await setTrackStatus(track.id, "concluded");
    await toggleTaskDoneWithTrackConclude(task.id);
    // 原探针（数「归档」步条数）是假闸：setTrackStatus 对状态未变的轨道不写系统步，误联动
    // 也不会产生第二条步。改 pin updatedAt：误联动会再走一次 setTrackStatus 写库 bump 它。
    expect((await db.tracks.get(track.id))?.updatedAt).toBe(concluded.updatedAt);
  });

  it("任务升格后补加重复规则：勾规则根代理完成一发，不归档轨道（next.id 承重钉，回归成入参 id 会在此红）", async () => {
    const task = await addTask({ title: "养成活" });
    const track = await promoteTaskToTrack(task);
    await updateTask(task.id, { recurrence: { freq: "daily", interval: 1, basis: "due" } });
    const next = await toggleTaskDoneWithTrackConclude(task.id);
    // 完成被代理到 occurrence（next.id ≠ 入参 id），轨道 refs 指的是规则本体——查不到即不归档。
    // design §四明文：勾一发就归档轨道、下一发又光板，是坑。
    expect(next.id).not.toBe(task.id);
    expect(next.done).toBe(true);
    expect((await db.tracks.get(track.id))?.status).toBe("active");
  });

  it("别的轨道（refs 不指向本任务）不受影响", async () => {
    const task = await addTask({ title: "活" });
    const other = await addTrack({ title: "无关轨道" });
    await toggleTaskDoneWithTrackConclude(task.id);
    expect((await db.tracks.get(other.id))?.status).toBe("active");
  });
});
