import { TaskSchema, type Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { occurrenceChildId } from "./occurrenceChildId.js";
import { projectTemplateChildren } from "./templateChildrenProjection.js";

function t(over: Partial<Task>): Task {
  return TaskSchema.parse({
    id: "x",
    title: "任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  });
}

const tplChild = (id: string, done = false) => t({ id, parentId: "rule-1", done });
const latestOcc = t({
  id: "occ:rule-1:2026-07-03",
  ruleId: "rule-1",
  scheduledAt: "2026-07-02T16:00:00.000Z",
});
const occChild = (templateChildId: string, done: boolean) =>
  t({ id: occurrenceChildId(latestOcc.id, templateChildId), parentId: latestOcc.id, done });

describe("projectTemplateChildren", () => {
  it("有目标发：effectiveDone 取 occ 子任务 done，targetOccChildId 为确定性 id", () => {
    const out = projectTemplateChildren(
      [tplChild("c1"), tplChild("c2")],
      latestOcc,
      [occChild("c1", true), occChild("c2", false)],
    );

    expect(out).toEqual([
      { child: tplChild("c1"), effectiveDone: true, targetOccChildId: occurrenceChildId(latestOcc.id, "c1") },
      { child: tplChild("c2"), effectiveDone: false, targetOccChildId: occurrenceChildId(latestOcc.id, "c2") },
    ]);
  });

  it("模板子任务本体 done=true（历史脏数据）不影响 effectiveDone", () => {
    const out = projectTemplateChildren([tplChild("c1", true)], latestOcc, [occChild("c1", false)]);
    expect(out[0].effectiveDone).toBe(false);
  });

  it("目标发的对应子任务缺失：effectiveDone=false 但 targetOccChildId 仍可写", () => {
    const out = projectTemplateChildren([tplChild("c1")], latestOcc, []);
    expect(out[0]).toEqual({
      child: tplChild("c1"),
      effectiveDone: false,
      targetOccChildId: occurrenceChildId(latestOcc.id, "c1"),
    });
  });

  it("无目标发（零 occurrence / 全 skipped 由调用方筛掉后传 null）：全部置灰", () => {
    const out = projectTemplateChildren([tplChild("c1", true)], null, []);
    expect(out[0]).toEqual({ child: tplChild("c1", true), effectiveDone: false, targetOccChildId: null });
  });

  it("空模板子任务列表 → 空数组", () => {
    expect(projectTemplateChildren([], latestOcc, [])).toEqual([]);
  });
});
