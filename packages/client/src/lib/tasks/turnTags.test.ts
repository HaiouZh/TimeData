import type { Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { allTags, filterByTags, turnBuckets } from "./turnTags.js";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "示例",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,    completedCount: 0,
    turn: null,
    turnAt: null,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

const now = new Date("2026-06-17T10:00:00.000Z");

describe("turnBuckets", () => {
  it("me 桶按 turnAt 升序，等最久在前", () => {
    const me = (turnAt: string) => task({ id: turnAt, turn: "me", turnAt });
    const result = turnBuckets(
      [me("2026-06-17T09:00:00.000Z"), me("2026-06-17T08:00:00.000Z"), me("2026-06-17T09:30:00.000Z")],
      now,
    );
    expect(result.me.map((t) => t.id)).toEqual([
      "2026-06-17T08:00:00.000Z",
      "2026-06-17T09:00:00.000Z",
      "2026-06-17T09:30:00.000Z",
    ]);
  });

  it("running / parked 分桶互斥；done 不进任何桶", () => {
    const result = turnBuckets(
      [
        task({ id: "r1", turn: "running", turnAt: "2026-06-17T09:00:00.000Z" }),
        task({ id: "p1", turn: "parked", turnAt: "2026-06-17T09:00:00.000Z" }),
        task({ id: "d1", turn: "me", turnAt: "2026-06-17T09:00:00.000Z", done: true }),
        task({ id: "n1", turn: null, turnAt: null }),
      ],
      now,
    );
    expect(result.me).toEqual([]);
    expect(result.running.map((t) => t.id)).toEqual(["r1"]);
    expect(result.parked.map((t) => t.id)).toEqual(["p1"]);
  });

  it("turnAt 为 null 的 turn 项排到该桶末尾", () => {
    const result = turnBuckets(
      [
        task({ id: "null", turn: "me", turnAt: null }),
        task({ id: "early", turn: "me", turnAt: "2026-06-17T08:00:00.000Z" }),
      ],
      now,
    );
    expect(result.me.map((t) => t.id)).toEqual(["early", "null"]);
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
