import type { Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { allTags, filterByTags } from "./turnTags.js";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "示例",
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

describe("turnTags public surface", () => {
  it("只导出 tag 聚合与筛选 helper", async () => {
    const mod = await import("./turnTags.js");
    expect(Object.keys(mod).sort()).toEqual(["allTags", "filterByTags"]);
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

describe("filterByTags", () => {
  it("selected 为空返回全部", () => {
    const tasks = [task({ id: "a", tags: ["x"] }), task({ id: "b", tags: [] })];
    expect(filterByTags(tasks, []).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("OR 语义：含任一选中 tag 即保留", () => {
    const tasks = [
      task({ id: "a", tags: ["重构"] }),
      task({ id: "b", tags: ["bug", "api"] }),
      task({ id: "c", tags: ["其他"] }),
      task({ id: "d", tags: [] }),
    ];
    expect(filterByTags(tasks, ["重构", "api"]).map((t) => t.id)).toEqual(["a", "b"]);
  });
});
