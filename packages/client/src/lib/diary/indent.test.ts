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

describe("applyIndent · 缩进字节前置（Tab→Shift+Tab 互逆的落点），无这条闸空跑", () => {
  // 缩进字节是 INDENT + indent（前置）还是 indent + INDENT（后置），251 条 diary 测试此前全绿——
  // 两者行为确实不同，只是没有一条断言盯住这个选择。这条闸直接锁死前置的具体产出。
  it("非空缩进（2 空格）Tab：新 Tab 前置在原缩进之前，不是拼在原缩进之后", () => {
    expect(run("  1. a\n  2. b", 13, 13, "in").text).toBe("  1. a\n\t  1. b");
  });

  // 后置在这个用例下会产出 "  1. a\n  \t1. b"：新加的 Tab 被塞在两个空格之后。表面上看只是
  // 字节顺序不同，但会连累 Shift+Tab：removableIndentLen 判定"是否有 Tab 可拿"看的是
  // indent.startsWith(INDENT)——后置产出的 "  \t" 不以 Tab 开头，起点判定就已经错位，
  // 下面这条互逆闸就是冲着这个坑写的。
  it("Tab → Shift+Tab 互逆：出层拿掉的必须正是刚加的那个 Tab，缩进整体回到原样", () => {
    const original = "  1. a\n  2. b";
    const indented = run(original, 13, 13, "in");
    if (indented === "NULL") throw new Error("expected Tab to indent, got NULL");
    const back = run(indented.text, indented.selStart, indented.selEnd, "out");
    if (back === "NULL") throw new Error("expected Shift+Tab to out-dent back, got NULL");
    expect(back.text).toBe(original);
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

  // 上面两条只测了 Tab（dir="in"）方向；围栏保护发生在 candidates 循环的 `if (prot[i]) continue`，
  // 早于 dir 分支，理应两个方向都放行——但这条早于分支的事实此前只被 Tab 方向的测试验证过。
  // dir="out" 分支自己另有一条防线（canIndentRows 见不到围栏内的行会返回 false），如果围栏过滤
  // 被误删，Shift+Tab 方向可能被那条防线顺手兜住而测不出来；这两条测试专门锁住围栏过滤本身。
  it("代码围栏内 Shift+Tab 同样放行（围栏保护不分方向）", () => {
    expect(applyIndent("```\n\t1. a\n```", 7, 7, "out")).toBeNull();
  });

  it("front-matter 内 Shift+Tab 同样放行（围栏保护不分方向）", () => {
    expect(applyIndent("---\n\t1. x\n---\n2. a", 7, 7, "out")).toBeNull();
  });
});

describe("applyIndent · 逃生口的真实判定路径（不能靠“恰好没变化”兜底）", () => {
  // T8（"1. A\n2. B" 顶层 Shift+Tab → null）即使删掉 removableIndentLen 过滤也会绿：块内编号
  // 本来就正确，拉直后文本没变化，靠 rowFirst===-1 的防御性早退顺手兜住。但这条兜底只在块内编号
  // 恰好正确时成立——块内编号一旦有错（用户手写跳号很常见），拉直会把编号改对从而"有变化"，
  // 逃生口就被吃掉，构成 WCAG 2.1.2 键盘陷阱。这条测试专门盯住 removableIndentLen 过滤本身。
  it("顶层 Shift+Tab 即使块内编号是坏的也放行（逃生口不能靠'恰好没变化'兜底）", () => {
    expect(run("1. A\n5. B", 8, 8, "out")).toBe("NULL");
  });
});

describe("applyIndent · 光标宽度补偿与模式 B 跨改动区平移", () => {
  // T14 的光标走的是"落在 marker 内一律吸到内容起点"的 newCol=newPre 分支，从未碰到
  // col+(newPre-oldPre) 这条真正做宽度补偿的算式；这条案例的光标落在内容里（col>oldPre），
  // 且宽度漂移不是 +1（4 空格缩进出层→0 缩进，markerLen 从 7 变 3，漂移 -4），能把
  // "写死 +1" 与"真正取 newPre-oldPre 差值"两种实现区分开。
  it("Shift+Tab 光标宽度补偿走真实的 markerLen 差值，不是硬编码 +1", () => {
    expect(run("1. A\n    1. BBBB\n2. C", 13, 13, "out")).toEqual({
      text: "1. A\n2. BBBB\n3. C",
      selStart: 9,
      selEnd: 9,
      span: [5, 21],
    });
  });

  // 模式 B 的 li（选区末行）是"普通行"，不属于被 Tab 命中的块（blockOf=-1），因此
  // rowLast < li：newLineStartOf(li) 必须走 `j > rowLast` 的 `+ delta` 平移分支，否则选区尾端
  // 会少算 delta 个字符（少了新插入的 Tab 的宽度）。
  it("模式 B 选区末端落在改动区间之外时按 delta 整体平移", () => {
    expect(run("1. A\n2. B\n普通行", 0, 13, "in")).toEqual({
      text: "1. A\n\t1. B\n普通行",
      selStart: 0,
      selEnd: 14,
      span: [5, 9],
    });
  });
});

describe("applyIndent · 单项块 Shift+Tab 不静默拉直编号", () => {
  // "1. a" 与 "2. c" 各自单独成块（被空行分隔），中间的 "\t5. b" 也单独成块（items=1）。
  // 若无单项块护栏，renumberBlock(rows, true) 会把这个孤立单项块强制拉直成 "1."，
  // 用户手写的 "5." 被静默改写——同样的输入走回车路径（orderedList.ts 有 straighten 护栏）
  // 不会发生这种事，Tab 路径不该是例外。
  it("孤立单项块出层保留用户手写的编号（不套用 renumberBlock 强制拉直）", () => {
    expect(run("1. a\n\n\t5. b\n\n2. c", 11, 11, "out")).toEqual({
      text: "1. a\n\n5. b\n\n2. c",
      selStart: 10,
      selEnd: 10,
      span: [6, 11],
    });
  });
});
