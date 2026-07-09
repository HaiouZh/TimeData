import { describe, expect, it } from "vitest";
import { applyEnterInOrderedList } from "./orderedList.js";

describe("applyEnterInOrderedList", () => {
  it("在 '1. 内容' 行末回车续 '2. '", () => {
    const v = "1. 买菜";
    const r = applyEnterInOrderedList(v, v.length, v.length);
    expect(r).toEqual({ value: "1. 买菜\n2. ", cursor: "1. 买菜\n2. ".length });
  });
  it("行中回车把余文带到下一项", () => {
    const v = "3. 前后";
    const r = applyEnterInOrderedList(v, 4, 4); // 光标在 "前" 后
    expect(r).toEqual({ value: "3. 前\n4. 后", cursor: 8 });
  });
  it("空列表项回车清掉序号（Obsidian 习惯）", () => {
    const v = "1. 事\n2. ";
    const r = applyEnterInOrderedList(v, v.length, v.length);
    expect(r).toEqual({ value: "1. 事\n", cursor: "1. 事\n".length });
  });
  it("非列表行返回 null", () => {
    expect(applyEnterInOrderedList("普通行", 3, 3)).toBeNull();
  });
  it("有选区时先删除选区再续号", () => {
    const v = "1. abcd";
    const r = applyEnterInOrderedList(v, 5, 7); // 选中 "cd"
    expect(r).toEqual({ value: "1. ab\n2. ", cursor: "1. ab\n2. ".length });
  });
});
