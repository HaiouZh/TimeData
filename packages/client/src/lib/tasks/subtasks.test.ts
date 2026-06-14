import { describe, expect, it } from "vitest";
import type { TaskSubtask } from "@timedata/shared";
import { insertSubtaskAfter, removeSubtaskAt, toggleSubtask, applyParentToggle, trimSubtasks } from "./subtasks.js";

const subs = (): TaskSubtask[] => [
  { id: "a", title: "一", done: false },
  { id: "b", title: "二", done: true },
];

describe("subtasks 行操作", () => {
  it("insertAfter 在指定索引后插入空子任务并返回新数组与新 id", () => {
    const { items, newId } = insertSubtaskAfter(subs(), 0, () => "new");
    expect(items.map((s) => s.id)).toEqual(["a", "new", "b"]);
    expect(newId).toBe("new");
    expect(items[1]).toEqual({ id: "new", title: "", done: false });
  });
  it("removeAt 删除指定索引", () => {
    expect(removeSubtaskAt(subs(), 0).map((s) => s.id)).toEqual(["b"]);
  });
  it("toggle 翻转 done", () => {
    expect(toggleSubtask(subs(), "a")[0].done).toBe(true);
  });
  it("勾选父任务 → 所有子任务 done=true", () => {
    expect(applyParentToggle(subs(), true).every((s) => s.done)).toBe(true);
  });
  it("取消父任务 → 所有子任务 done=false", () => {
    expect(applyParentToggle(subs(), false).every((s) => !s.done)).toBe(true);
  });
  it("trim 丢弃空标题子任务并 trim", () => {
    const t = trimSubtasks([{ id: "a", title: "  保留 ", done: false }, { id: "b", title: "   ", done: false }]);
    expect(t).toEqual([{ id: "a", title: "保留", done: false }]);
  });
});
