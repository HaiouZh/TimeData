import type { Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { allTags, filterByTags, filterTasks, type TaskFilter, tagColor } from "./turnTags.js";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "示例",
    parentId: null,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

const emptyFilter: TaskFilter = { searchQuery: "", includeTags: [], excludeTags: [], tagMode: "and" };

describe("turnTags public surface", () => {
  it("导出聚合/旧筛选/新筛选/取色 helper", async () => {
    const mod = await import("./turnTags.js");
    expect(Object.keys(mod).sort()).toEqual(["allTags", "filterByTags", "filterTasks", "tagColor"]);
  });
});

describe("allTags", () => {
  it("聚合去重，按 count 降序、同 count 字典序", () => {
    const result = allTags([
      task({ id: "a", tags: ["重构", "bug"] }),
      task({ id: "b", tags: ["bug"] }),
      task({ id: "c", tags: ["重构", "api"] }),
    ]);
    expect(result).toEqual([
      { tag: "bug", count: 2 },
      { tag: "重构", count: 2 },
      { tag: "api", count: 1 },
    ]);
  });
});

describe("filterByTags（旧 OR，本期暂留）", () => {
  it("selected 为空返回全部", () => {
    const tasks = [task({ id: "a", tags: ["x"] }), task({ id: "b", tags: [] })];
    expect(filterByTags(tasks, []).map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("filterTasks", () => {
  it("空筛选原样返回", () => {
    const tasks = [task({ id: "a", tags: ["x"] }), task({ id: "b", tags: [] })];
    expect(filterTasks(tasks, emptyFilter).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("含 AND：tags ⊇ includeTags 才保留", () => {
    const tasks = [
      task({ id: "a", tags: ["工作", "紧急"] }),
      task({ id: "b", tags: ["工作"] }),
      task({ id: "c", tags: ["紧急"] }),
    ];
    const f: TaskFilter = { ...emptyFilter, includeTags: ["工作", "紧急"] };
    expect(filterTasks(tasks, f).map((t) => t.id)).toEqual(["a"]);
  });

  it("含 OR：与 includeTags 交集非空即保留", () => {
    const tasks = [
      task({ id: "a", tags: ["工作"] }),
      task({ id: "b", tags: ["生活"] }),
      task({ id: "c", tags: ["其他"] }),
    ];
    const f: TaskFilter = { ...emptyFilter, includeTags: ["工作", "生活"], tagMode: "or" };
    expect(filterTasks(tasks, f).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("排除：与 excludeTags 交集非空则剔除", () => {
    const tasks = [task({ id: "a", tags: ["废弃"] }), task({ id: "b", tags: ["保留"] })];
    const f: TaskFilter = { ...emptyFilter, excludeTags: ["废弃"] };
    expect(filterTasks(tasks, f).map((t) => t.id)).toEqual(["b"]);
  });

  it("关键词：title 含全部词（AND）", () => {
    const tasks = [
      task({ id: "a", title: "写月度报告草稿" }),
      task({ id: "b", title: "写周报" }),
      task({ id: "c", title: "报告评审" }),
    ];
    const f: TaskFilter = { ...emptyFilter, searchQuery: "写 报告" };
    expect(filterTasks(tasks, f).map((t) => t.id)).toEqual(["a"]);
  });

  it("空 query 跳过关键词轴", () => {
    const tasks = [task({ id: "a", title: "abc" }), task({ id: "b", title: "def" })];
    expect(filterTasks(tasks, { ...emptyFilter, searchQuery: "   " }).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("三轴 AND 叠加：含 ∧ 排除 ∧ 关键词", () => {
    const tasks = [
      task({ id: "a", title: "工作报告", tags: ["工作"] }),
      task({ id: "b", title: "工作报告", tags: ["工作", "废弃"] }),
      task({ id: "c", title: "工作笔记", tags: ["工作"] }),
      task({ id: "d", title: "生活报告", tags: ["生活"] }),
    ];
    const f: TaskFilter = { searchQuery: "报告", includeTags: ["工作"], excludeTags: ["废弃"], tagMode: "and" };
    expect(filterTasks(tasks, f).map((t) => t.id)).toEqual(["a"]);
  });

  it("含与排除互斥不冲突（同名分别命中各自轴语义）", () => {
    const tasks = [task({ id: "a", tags: ["x"] }), task({ id: "b", tags: ["y"] })];
    const f: TaskFilter = { ...emptyFilter, includeTags: ["x"], excludeTags: ["y"] };
    expect(filterTasks(tasks, f).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("tagColor", () => {
  it("返回合法 #RRGGBB", () => {
    expect(tagColor("工作")).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("确定性：同名同色", () => {
    expect(tagColor("工作")).toBe(tagColor("工作"));
  });

  it("不同名分布到色板（不全塌成一种色）", () => {
    const names = ["工作", "生活", "紧急", "学习", "健康", "财务", "家庭", "项目"];
    const colors = new Set(names.map(tagColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});
