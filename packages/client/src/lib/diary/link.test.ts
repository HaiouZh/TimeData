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
    // 下标改 19（审查 H）：`"[标题](https://a.com)"` 只有 19 个字符（`[标题](https://a.com)`
    // 逐字符数：[ 标 题 ] ( h t t p s : / / a . c o m ) = 19），原先的 21 是照抄边界表时把
    // CJK 当成两字节的下标错误，真实 textarea 给不出这个下标；21 恰好越界到字符串外，行为
    // 仍与"紧贴 ) 之后"一致（都 > close 走同一分支），但没测到真实的"紧贴 ) 之后"边界。
    expect(run("[标题](https://a.com)", 19, 19)).toEqual({
      kind: "replace",
      text: "[标题](https://a.com)[]()",
      selStart: 20,
      selEnd: 20,
      span: [19, 19],
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

describe("applyLinkShortcut · G4 代码围栏 / front-matter 内吃掉按键但不生成链接", () => {
  // 与 indent.ts 的围栏豁免同一份 scanProtected（listModel.ts），不另写扫描器。
  // 这是审查发现的缺口：原设计（design §4.4）没提，围栏内插入 "[]()" 一样会污染 vault。
  //
  // 期望值 null → { kind: "noop" } 是本次唯一允许改动的现有期望（审查 A 拍板的行为变更）：
  // 本函数内 case③「选区含换行」已经是"不生成链接但仍 preventDefault"（noop），围栏内属于
  // 同一类"这里做不成链接"的情形，没理由用相反的处理方式把按键交还浏览器——Ctrl+K 也不像
  // Tab 那样承担键盘逃生口职责，不需要放行给 Firefox 跳搜索栏 / Chrome 跳地址栏。
  it("代码围栏内按 Ctrl+K 吃掉按键（不插入链接骨架，不交还浏览器）", () => {
    expect(applyLinkShortcut("```\nhttps://a.com\n```", 8, 8)).toEqual({ kind: "noop" });
  });

  it("front-matter 内按 Ctrl+K 吃掉按键（不插入链接骨架，不交还浏览器）", () => {
    expect(applyLinkShortcut("---\nhttps://a.com\n---\n正文", 8, 8)).toEqual({ kind: "noop" });
  });
});

describe("applyLinkShortcut · 审查覆盖缺口补测（B/C/D/F）", () => {
  // B：`prot[startLine] || prot[endLine]` 两个半边分别补测——现有两条 G4 用例都是塌陷光标
  // （start === end），两个半边被"顺带"同时覆盖，单独砍掉任一半边都不会让那两条用例变红。
  it("B1 选区起点在围栏外、终点落进围栏开启行 → 仍整体拦下（不只依赖 prot[startLine]）", () => {
    // 若把守卫误改成只看 prot[startLine]（丢掉 prot[endLine] 半边），这里会把围栏开启行
    // 的 "```" 改写成 "[```]()"——正是围栏豁免要挡的那类 vault 污染。
    expect(applyLinkShortcut("a\n```\nx\n```", 1, 5)).toEqual({ kind: "noop" });
  });

  it("B2 选区起点落在围栏闭合行、终点在围栏外 → 仍整体拦下（不只依赖 prot[endLine]）", () => {
    // 对称情形：若把守卫误改成只看 prot[endLine]（丢掉 prot[startLine] 半边），这里会把
    // 围栏闭合行的最后一个反引号改写掉（"```" → "``[`]()"），同样污染 vault。
    expect(applyLinkShortcut("```\nx\n```\na", 8, 10)).toEqual({ kind: "noop" });
  });

  // C：命中判定 selStart === close 这一端点是最高频路径的落点——case ⑦ 产出 "[文字]()" 后
  // 光标恰好落在 close，"打标题→跳去填地址" 的连招第二下就走这个端点。现有 K13/K14 钉的是
  // 光标在标题里 / 在 []() 内部，都不钉这个端点，必须单独补。
  it("C 光标恰好落在链接 close 端点（) 前一位）→ 命中，select 到 URL 段", () => {
    expect(run("[a](b)", 5, 5)).toEqual({
      kind: "select",
      selStart: 4,
      selEnd: 5,
      selected: "b",
    });
  });

  // D：嵌套方括号回退分支——findLinkAt 遇到嵌套 "[" 时把扫描起点重置到那个新 "["
  // （`i = j`）才能续扫出内层有效链接；重置到 `j + 1` 会跳过那个 "["，导致内层链接
  // 找不到，退化成在光标处插入新的 "[]()"，破坏原本应该被识别的链接结构。
  it("D 光标落在被外层未闭合方括号包住的内层有效链接里 → 命中内层链接的 URL 段", () => {
    expect(run("见[备注[细则](https://a.com)", 6, 6)).toEqual({
      kind: "select",
      selStart: 9,
      selEnd: 22,
      selected: "https://a.com",
    });
  });

  // F：K7（"a\nb"）钉 noop 分支，K23（"https://a.com/a b"）钉 /\s/ 闸，但没有一条同时压住
  // 两道闸——跨行且 trim 后长得像 URL，正是设计文档记载的原始事故形态：WHATWG URL 解析器
  // 会先剥掉换行再解析，`new URL("https://a.com\nfoo")` 不抛且 href 是 "https://a.comfoo/"。
  it("F 跨行选区 trim 后长得像 URL → 仍先被换行闸拦下（不会被误判成合法 URL）", () => {
    expect(run("https://a.com\nfoo", 0, 17)).toBe("NOOP");
  });
});
