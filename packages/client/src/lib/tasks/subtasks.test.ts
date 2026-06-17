import { describe, expect, it } from "vitest";
import type { TaskSubtask } from "@timedata/shared";
import {
  insertSubtaskAfter,
  removeSubtaskAt,
  toggleSubtask,
  applyParentToggle,
  trimSubtasks,
  subtasksDifferStructurally,
  reorderSubtasks,
  subtaskProgress,
} from "./subtasks.js";

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

describe("subtasksDifferStructurally", () => {
  const a = { id: "1", title: "a", done: false };
  const b = { id: "2", title: "b", done: false };

  it("长度变化 -> true（新增/删除）", () => {
    expect(subtasksDifferStructurally([a], [a, b])).toBe(true);
    expect(subtasksDifferStructurally([a, b], [a])).toBe(true);
  });

  it("done 翻转 -> true（勾选）", () => {
    expect(subtasksDifferStructurally([a], [{ ...a, done: true }])).toBe(true);
  });

  it("id 顺序变化 -> true", () => {
    expect(subtasksDifferStructurally([a, b], [b, a])).toBe(true);
  });

  it("只改 title -> false（仅文字编辑）", () => {
    expect(subtasksDifferStructurally([a], [{ ...a, title: "改了" }])).toBe(false);
  });

  it("完全相同 -> false", () => {
    expect(subtasksDifferStructurally([a, b], [a, b])).toBe(false);
  });
});

describe("reorderSubtasks", () => {
  const r = (): TaskSubtask[] => [
    { id: "a", title: "一", done: false },
    { id: "b", title: "二", done: false },
    { id: "c", title: "三", done: false },
  ];

  it("把 a 移到 c 后面", () => {
    expect(reorderSubtasks(r(), "a", "c").map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("把 c 移到最前", () => {
    expect(reorderSubtasks(r(), "c", "a").map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("activeId === overId -> 原数组不变", () => {
    expect(reorderSubtasks(r(), "b", "b").map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("未知 id -> 原数组不变", () => {
    expect(reorderSubtasks(r(), "x", "a").map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(reorderSubtasks(r(), "a", "x").map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("subtaskProgress", () => {
  it("无子任务 -> null（不渲染进度条）", () => {
    expect(subtaskProgress(0, 0)).toBeNull();
  });

  it("部分完成 -> 比例", () => {
    expect(subtaskProgress(1, 4)).toBe(0.25);
  });

  it("全部完成 -> 1", () => {
    expect(subtaskProgress(3, 3)).toBe(1);
  });

  it("done 超过 total -> 夹取到 1", () => {
    expect(subtaskProgress(5, 3)).toBe(1);
  });

  it("done 为负 -> 夹取到 0", () => {
    expect(subtaskProgress(-1, 3)).toBe(0);
  });
});
