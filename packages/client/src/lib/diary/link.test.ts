import { describe, expect, it } from "vitest";
import { applyLinkShortcut } from "./link.js";
import { previewEdit } from "./textareaEdit.js";

// K1–K27 边界表：全部为原型（docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/4-键位语义.md
// §2.8，同目录 p2keys-proto2.mjs）实跑输出，直接抄自该文档 / 脚本打印结果。K28（IME 组合态）
// 是"纯函数根本不被调用"，不在这张表里测——它由 DiaryPage.test.tsx 的 jsdom 接线测试覆盖
// （与 Tab 共用同一处 isComposing 守卫）。
type Result =
  | "NULL"
  | "NOOP"
  | { kind: "select"; selStart: number; selEnd: number; selected: string }
  | { kind: "replace"; text: string; selStart: number; selEnd: number; span: [number, number] };

function run(value: string, selStart: number, selEnd: number): Result {
  const e = applyLinkShortcut(value, selStart, selEnd);
  if (!e) return "NULL";
  if (e.kind === "noop") return "NOOP";
  if (e.kind === "select") {
    return { kind: "select", selStart: e.selStart, selEnd: e.selEnd, selected: value.slice(e.selStart, e.selEnd) };
  }
  return {
    kind: "replace",
    text: previewEdit(value, e),
    selStart: e.selStart,
    selEnd: e.selEnd,
    span: [e.start, e.end],
  };
}

describe("applyLinkShortcut · K1–K27 边界表", () => {
  it("K1 无选区", () => {
    expect(run("abc", 1, 1)).toEqual({
      kind: "replace",
      text: "a[]()bc",
      selStart: 2,
      selEnd: 2,
      span: [1, 1],
    });
  });

  it("K2 选中普通文字", () => {
    expect(run("今天读了两章", 2, 4)).toEqual({
      kind: "replace",
      text: "今天[读了]()两章",
      selStart: 7,
      selEnd: 7,
      span: [2, 4],
    });
  });

  it("K3 选中 https URL", () => {
    expect(run("见 https://a.com 这里", 2, 15)).toEqual({
      kind: "replace",
      text: "见 [](https://a.com) 这里",
      selStart: 3,
      selEnd: 3,
      span: [2, 15],
    });
  });

  it("K4 大写 HTTP（判定命中但输出不改大小写）", () => {
    expect(run("HTTP://A.com", 0, 12)).toEqual({
      kind: "replace",
      text: "[](HTTP://A.com)",
      selStart: 1,
      selEnd: 1,
      span: [0, 12],
    });
  });

  it("K5 两端半角空格留在链接外面", () => {
    expect(run("x  中文  y", 1, 8)).toEqual({
      kind: "replace",
      text: "x  [中文  y]()",
      selStart: 11,
      selEnd: 11,
      span: [3, 8],
    });
  });

  it("K6 两端全角空格留在链接外面", () => {
    expect(run("x　中文　y", 1, 6)).toEqual({
      kind: "replace",
      text: "x　[中文　y]()",
      selStart: 9,
      selEnd: 9,
      span: [2, 6],
    });
  });

  it("K7 选区含换行 → noop（吃掉按键但不改动，且必须早于 URL 判定）", () => {
    expect(run("a\nb", 0, 3)).toBe("NOOP");
  });

  it("K8 选区尾部仅换行：trim 掉换行后走普通文字分支，换行留在链接外面", () => {
    expect(run("abc\n", 0, 4)).toEqual({
      kind: "replace",
      text: "[abc]()\n",
      selStart: 6,
      selEnd: 6,
      span: [0, 3],
    });
  });

  it("K9 光标在链接文本里 → select 到 URL 段，文本不动", () => {
    expect(run("[标题](https://a.com)", 2, 2)).toEqual({
      kind: "select",
      selStart: 5,
      selEnd: 18,
      selected: "https://a.com",
    });
  });

  it("K10 光标在链接 URL 里 → select 到 URL 段", () => {
    expect(run("[标题](https://a.com)", 10, 10)).toEqual({
      kind: "select",
      selStart: 5,
      selEnd: 18,
      selected: "https://a.com",
    });
  });

  it("K11 光标紧贴 [ 之前 → 不命中现有链接，在旁边插入新链接", () => {
    expect(run("[标题](https://a.com)", 0, 0)).toEqual({
      kind: "replace",
      text: "[]()[标题](https://a.com)",
      selStart: 1,
      selEnd: 1,
      span: [0, 0],
    });
  });

  it("K12 光标紧贴 ) 之后 → 不命中现有链接，在旁边插入新链接", () => {
    expect(run("[标题](https://a.com)", 21, 21)).toEqual({
      kind: "replace",
      text: "[标题](https://a.com)[]()",
      selStart: 22,
      selEnd: 22,
      span: [21, 21],
    });
  });

  it("K13 空 URL 链接 [标题]() → select 命中，光标落进空括号（打标题→跳去填地址连招第一步）", () => {
    expect(run("[标题]()", 2, 2)).toEqual({
      kind: "select",
      selStart: 5,
      selEnd: 5,
      selected: "",
    });
  });

  it("K14 刚生成的 []() 再按一次 → select 命中空括号（连招第二步）", () => {
    expect(run("[]()", 1, 1)).toEqual({
      kind: "select",
      selStart: 3,
      selEnd: 3,
      selected: "",
    });
  });

  it("K15 URL 带嵌套括号（维基百科式）：深度计数选中含内层括号的整段 URL", () => {
    expect(run("[F](https://zh.wikipedia.org/wiki/Foo_(bar))", 5, 5)).toEqual({
      kind: "select",
      selStart: 4,
      selEnd: 43,
      selected: "https://zh.wikipedia.org/wiki/Foo_(bar)",
    });
  });

  it("K16 选中 1.5 不误判成 URL", () => {
    expect(run("1.5", 0, 3)).toEqual({
      kind: "replace",
      text: "[1.5]()",
      selStart: 6,
      selEnd: 6,
      span: [0, 3],
    });
  });

  it("K17 选中日期不误判成 URL", () => {
    expect(run("2026-07-25", 0, 10)).toEqual({
      kind: "replace",
      text: "[2026-07-25]()",
      selStart: 13,
      selEnd: 13,
      span: [0, 10],
    });
  });

  it("K18 选中 mailto 被协议白名单挡下，走普通文字分支", () => {
    expect(run("mailto:a@b.com", 0, 14)).toEqual({
      kind: "replace",
      text: "[mailto:a@b.com]()",
      selStart: 17,
      selEnd: 17,
      span: [0, 14],
    });
  });

  it("K19 选中 Windows 路径（protocol c: 被协议白名单挡下）", () => {
    expect(run("C:\\Users\\x", 0, 10)).toEqual({
      kind: "replace",
      text: "[C:\\Users\\x]()",
      selStart: 13,
      selEnd: 13,
      span: [0, 10],
    });
  });

  it("K20 全空白选区：一个字节都不动用户已有的空白，走 case ⑤（无选区语义）", () => {
    expect(run("a   b", 1, 4)).toEqual({
      kind: "replace",
      text: "a[]()   b",
      selStart: 2,
      selEnd: 2,
      span: [1, 1],
    });
  });

  it("K21 选区跨链接边界（已知 degenerate，不做嵌套检测）", () => {
    expect(run("x[a](b)y", 0, 8)).toEqual({
      kind: "replace",
      text: "[x[a](b)y]()",
      selStart: 11,
      selEnd: 11,
      span: [0, 8],
    });
  });

  it("K22 选中链接内的一段文本 → select 到 URL 段", () => {
    expect(run("[标题](https://a.com)", 1, 3)).toEqual({
      kind: "select",
      selStart: 5,
      selEnd: 18,
      selected: "https://a.com",
    });
  });

  it("K23 含空格的 URL 文本被 /\\s/ 闸挡下，走普通文字分支", () => {
    expect(run("https://a.com/a b", 0, 17)).toEqual({
      kind: "replace",
      text: "[https://a.com/a b]()",
      selStart: 20,
      selEnd: 20,
      span: [0, 17],
    });
  });

  it("K24 选区恰等于整条链接 → select 到 URL 段", () => {
    expect(run("[a](b)", 0, 6)).toEqual({
      kind: "select",
      selStart: 4,
      selEnd: 5,
      selected: "b",
    });
  });

  it("K25 光标在 ] 与 ( 之间 → select 到 URL 段", () => {
    expect(run("[标题](https://a.com)", 4, 4)).toEqual({
      kind: "select",
      selStart: 5,
      selEnd: 18,
      selected: "https://a.com",
    });
  });

  it("K26 同行两条链接，光标在第二条里 → select 第二条的 URL", () => {
    expect(run("[a](x) [b](y)", 11, 11)).toEqual({
      kind: "select",
      selStart: 11,
      selEnd: 12,
      selected: "y",
    });
  });

  it("K27 未闭合的 [a](x：扫描器不认，落 case ⑤（无选区）在光标处插入", () => {
    expect(run("[a](x", 2, 2)).toEqual({
      kind: "replace",
      text: "[a[]()](x",
      selStart: 3,
      selEnd: 3,
      span: [2, 2],
    });
  });
});

describe("applyLinkShortcut · G4 代码围栏 / front-matter 内一律放行", () => {
  // 与 indent.ts 的围栏豁免同一份 scanProtected（listModel.ts），不另写扫描器。
  // 这是审查发现的缺口：原设计（design §4.4）没提，围栏内插入 "[]()" 一样会污染 vault。
  it("代码围栏内按 Ctrl+K 放行（不插入链接骨架）", () => {
    expect(applyLinkShortcut("```\nhttps://a.com\n```", 8, 8)).toBeNull();
  });

  it("front-matter 内按 Ctrl+K 放行", () => {
    expect(applyLinkShortcut("---\nhttps://a.com\n---\n正文", 8, 8)).toBeNull();
  });
});
