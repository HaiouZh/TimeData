import { describe, expect, it } from "vitest";
import { applyIndent } from "./indent.js";
import { previewEdit } from "./textareaEdit.js";

// T1–T20 边界表：全部为原型（docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/4-键位语义.md §1.8）
// 实跑输出，直接抄自那张表。表本身是在"gap 写死单空格"的假设下跑的，但表里所有输入的 gap 恰好
// 都是单空格，输出数字因此全部仍然成立；本文件末尾另补一条表里没有的可变 gap 用例。
function run(
  value: string,
  selStart: number,
  selEnd: number,
  dir: "in" | "out",
): "NULL" | { text: string; selStart: number; selEnd: number; span: [number, number] } {
  const e = applyIndent(value, selStart, selEnd, dir);
  if (!e) return "NULL";
  return {
    text: previewEdit(value, e),
    selStart: e.selStart,
    selEnd: e.selEnd,
    span: [e.start, e.end],
  };
}

describe("applyIndent · T1–T20 边界表", () => {
  it("T1 光标在内容里 Tab", () => {
    expect(run("1. A\n2. B\n3. C", 8, 8, "in")).toEqual({
      text: "1. A\n\t1. B\n2. C",
      selStart: 9,
      selEnd: 9,
      span: [5, 14],
    });
  });

  it("T2 光标在行首 col0 Tab（吸到内容起点）", () => {
    expect(run("1. A\n2. B\n3. C", 5, 5, "in")).toEqual({
      text: "1. A\n\t1. B\n2. C",
      selStart: 9,
      selEnd: 9,
      span: [5, 14],
    });
  });

  it("T3 光标在 marker 中间 Tab（吸到内容起点）", () => {
    expect(run("1. A\n2. B\n3. C", 6, 6, "in")).toEqual({
      text: "1. A\n\t1. B\n2. C",
      selStart: 9,
      selEnd: 9,
      span: [5, 14],
    });
  });

  it("T4 光标在行尾 Tab", () => {
    expect(run("1. A\n2. B\n3. C", 9, 9, "in")).toEqual({
      text: "1. A\n\t1. B\n2. C",
      selStart: 10,
      selEnd: 10,
      span: [5, 14],
    });
  });

  it("T5 已比上一行深再 Tab → null（父行约束，防跳级）", () => {
    expect(run("1. A\n\t2. B\n3. C", 6, 6, "in")).toBe("NULL");
  });

  it("T5b 同层第二子项 Tab（不带子树，孙辈原样不动）", () => {
    expect(run("1. A\n\t1. b1\n\t2. b2", 13, 13, "in")).toEqual({
      text: "1. A\n\t1. b1\n\t\t1. b2",
      selStart: 17,
      selEnd: 17,
      span: [12, 18],
    });
  });

  it("T6 空列表项 Tab（最高频路径：回车出新项后立刻缩进）", () => {
    expect(run("1. A\n2. ", 8, 8, "in")).toEqual({
      text: "1. A\n\t1. ",
      selStart: 9,
      selEnd: 9,
      span: [5, 8],
    });
  });

  it("T7 非列表行 Tab → null 放行", () => {
    expect(run("1. A\n普通行", 7, 7, "in")).toBe("NULL");
  });

  it("T8 顶层 Shift+Tab → null（唯一逃生口，不得被吃掉）", () => {
    expect(run("1. A\n2. B", 8, 8, "out")).toBe("NULL");
  });

  it("T9 一层 Shift+Tab 出层并入父列表", () => {
    expect(run("1. A\n\t1. B\n2. C", 9, 9, "out")).toEqual({
      text: "1. A\n2. B\n3. C",
      selStart: 8,
      selEnd: 8,
      span: [5, 15],
    });
  });

  it("T10 多行整行选区 Tab", () => {
    expect(run("1. A\n2. B\n3. C", 5, 14, "in")).toEqual({
      text: "1. A\n\t1. B\n\t2. C",
      selStart: 5,
      selEnd: 16,
      span: [5, 14],
    });
  });

  it("T11 选区末端落在行首，不把那一行算进来", () => {
    expect(run("1. A\n2. B\n3. C", 0, 10, "in")).toEqual({
      text: "1. A\n\t1. B\n2. C",
      selStart: 0,
      selEnd: 10,
      span: [5, 14],
    });
  });

  it("T12 选区混非列表行：非列表行原样不动，替换区间收窄到真正变化的首末行", () => {
    expect(run("1. A\n普通行\n2. B\n3. C", 0, 18, "in")).toEqual({
      text: "1. A\n普通行\n1. B\n\t1. C",
      selStart: 0,
      selEnd: 19,
      span: [9, 18],
    });
  });

  it("T13 块首行 Tab → null（父行约束）", () => {
    expect(run("1. A\n\t1. a1\n2. B", 3, 3, "in")).toBe("NULL");
  });

  it("T14 编号宽度 9→10：光标按新 markerLen 落位，不是硬编码 +1", () => {
    const before = `${Array.from({ length: 9 }, (_, i) => `${i + 1}. x`).join("\n")}\n\t1. y\n11. z`;
    const after = `${Array.from({ length: 9 }, (_, i) => `${i + 1}. x`).join("\n")}\n10. y\n11. z`;
    expect(run(before, 47, 47, "out")).toEqual({
      text: after,
      selStart: 49,
      selEnd: 49,
      span: [45, 50],
    });
  });

  it("T15 单行内部分选区 Tab：选区整行化", () => {
    expect(run("1. AAAA\n2. BBBB", 9, 11, "in")).toEqual({
      text: "1. AAAA\n\t1. BBBB",
      selStart: 8,
      selEnd: 16,
      span: [8, 15],
    });
  });

  it("T16 空格缩进 Shift+Tab（读兼容老 vault 文件）", () => {
    expect(run("1. A\n    1. B\n2. C", 12, 12, "out")).toEqual({
      text: "1. A\n2. B\n3. C",
      selStart: 8,
      selEnd: 8,
      span: [5, 18],
    });
  });

  it("T17 空行分隔两块，选区跨块：各块独立重排，替换区间跨越未改动的中间行", () => {
    expect(run("1. A\n2. B\n\n1. C\n2. D", 0, 19, "in")).toEqual({
      text: "1. A\n\t1. B\n\n1. C\n\t1. D",
      selStart: 0,
      selEnd: 22,
      span: [5, 20],
    });
  });

  it("T18 出层带子项：不带子树，孙辈原样留在原深度", () => {
    expect(run("1. A\n\t1. b\n\t\t1. c", 8, 8, "out")).toEqual({
      text: "1. A\n2. b\n\t\t1. c",
      selStart: 8,
      selEnd: 8,
      span: [5, 10],
    });
  });

  it("T19 Shift+Tab 光标在缩进区内", () => {
    expect(run("1. A\n\t1. B", 5, 5, "out")).toEqual({
      text: "1. A\n2. B",
      selStart: 8,
      selEnd: 8,
      span: [5, 10],
    });
  });

  it("T20 空列表项 Shift+Tab", () => {
    expect(run("1. A\n\t1. ", 9, 9, "out")).toEqual({
      text: "1. A\n2. ",
      selStart: 8,
      selEnd: 8,
      span: [5, 9],
    });
  });
});

describe("applyIndent · 可变 gap（M3 裁决：gap 不写死单空格）", () => {
  it("双空格 gap 按 Tab 原样保留，光标按 markerLen 落位（不是硬编码 +2）", () => {
    // "1.  A\n2.  B" 光标落在第二行行尾，按 Tab：目标行新增一级缩进，块整体重排；
    // gap 全程原样保留为两个空格，新 markerLen = indent(1) + numText(1) + "."(1) + gap(2) = 5，
    // 光标 = 新行起点(6) + markerLen(5) + content 长度(1，caret 原本在行尾) = 12。
    const e = applyIndent("1.  A\n2.  B", 11, 11, "in");
    expect(e).toMatchObject({ kind: "replace", start: 6, end: 11, text: "\t1.  B" });
    expect(e).not.toBeNull();
    if (e?.kind !== "replace") throw new Error("expected replace");
    expect(previewEdit("1.  A\n2.  B", e)).toBe("1.  A\n\t1.  B");
    expect(e.selStart).toBe(12);
    expect(e.selEnd).toBe(12);
  });
});

describe("applyIndent · 代码围栏 / front-matter 内一律放行", () => {
  it("代码围栏内的 '1. x' 不被当作列表项，Tab 放行", () => {
    expect(applyIndent("```\n1. a\n```", 6, 6, "in")).toBeNull();
  });

  it("front-matter 内即使长得像列表项也不被认，Tab 放行", () => {
    // front-matter 体内恰好是 "1. x" 这种看起来像列表项的一行：scanProtected 已把它标记保护，
    // 候选行过滤要在 parseItem 判定之前/之外就把它挡掉，不能只靠"内容不像列表"侥幸放行。
    expect(applyIndent("---\n1. x\n---\n2. a", 6, 6, "in")).toBeNull();
  });
});
