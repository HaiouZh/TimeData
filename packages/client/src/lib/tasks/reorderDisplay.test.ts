import { describe, expect, it } from "vitest";
import { applyOptimisticOrder } from "./reorderDisplay.js";

interface Row {
  id: string;
  label: string;
}

const rows: Row[] = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

describe("applyOptimisticOrder", () => {
  it("按目标序重排（c 移到最前）", () => {
    expect(applyOptimisticOrder(rows, ["c", "a", "b"])).toEqual([
      { id: "c", label: "C" },
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
  });

  it("顺序不变返回等价新数组（不依赖调用方判断是否有变化）", () => {
    expect(applyOptimisticOrder(rows, ["a", "b", "c"])).toEqual(rows);
  });

  it("长度不符 → 原样返回（乐观序只针对同一作用域 ids）", () => {
    expect(applyOptimisticOrder(rows, ["a", "b"])).toEqual(rows);
  });

  it("id 集合不一致（含未知 id）→ 原样返回", () => {
    expect(applyOptimisticOrder(rows, ["a", "b", "x"])).toEqual(rows);
  });

  it("有 id 查不到行（行已删/漏传）→ 原样返回，不产出缺口", () => {
    expect(applyOptimisticOrder([{ id: "a", label: "A" }, { id: "c", label: "C" }], ["c", "a", "b"])).toEqual([
      { id: "a", label: "A" },
      { id: "c", label: "C" },
    ]);
  });

  it("空数组保持空", () => {
    expect(applyOptimisticOrder([], [])).toEqual([]);
  });
});
