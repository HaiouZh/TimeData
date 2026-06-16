import { describe, expect, it } from "vitest";
import { reorderedTaskSortOrders } from "./taskSort.js";

describe("reorderedTaskSortOrders", () => {
  const pool = [
    { id: "a", sortOrder: 10 },
    { id: "b", sortOrder: 20 },
    { id: "c", sortOrder: 30 },
  ];

  it("把 c 移到最前：按槽位 [10,20,30] 回填，回报变化项", () => {
    expect(reorderedTaskSortOrders(pool, ["c", "a", "b"])).toEqual([
      { id: "c", sortOrder: 10 },
      { id: "a", sortOrder: 20 },
      { id: "b", sortOrder: 30 },
    ]);
  });

  it("顺序不变则无变化", () => {
    expect(reorderedTaskSortOrders(pool, ["a", "b", "c"])).toEqual([]);
  });

  it("成员不一致（缺/多/未知 id）则返回空、不动", () => {
    expect(reorderedTaskSortOrders(pool, ["a", "b"])).toEqual([]);
    expect(reorderedTaskSortOrders(pool, ["a", "b", "x"])).toEqual([]);
  });
});
