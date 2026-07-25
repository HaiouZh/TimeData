import { describe, expect, it } from "vitest";
import { applyEnterInOrderedList } from "./orderedList.js";
import { previewEdit } from "./textareaEdit.js";

// applyEnterInOrderedList 现在返回 EditAction 描述符（Task 2 迁移），不再是 { value, cursor }。
// 这个助手把描述符应用回原文，让下面 6 条断言保持迁移前的形状，期望值一字不改。
function applyTo(value: string, action: ReturnType<typeof applyEnterInOrderedList>) {
  if (action?.kind !== "replace") return null;
  const result = { value: previewEdit(value, action), cursor: action.selStart };
  // selEnd 漂了就多带一个键，toEqual 当场红；不漂则形状与迁移前完全一致
  return action.selEnd === action.selStart ? result : { ...result, selEnd: action.selEnd };
}

describe("applyEnterInOrderedList", () => {
  it("在 '1. 内容' 行末回车续 '2. '", () => {
    const v = "1. 买菜";
    const r = applyTo(v, applyEnterInOrderedList(v, v.length, v.length));
    expect(r).toEqual({ value: "1. 买菜\n2. ", cursor: "1. 买菜\n2. ".length });
  });
  it("行中回车把余文带到下一项", () => {
    const v = "3. 前后";
    const r = applyTo(v, applyEnterInOrderedList(v, 4, 4)); // 光标在 "前" 后
    expect(r).toEqual({ value: "3. 前\n4. 后", cursor: 8 });
  });
  it("空列表项回车清掉序号（Obsidian 习惯）", () => {
    const v = "1. 事\n2. ";
    const r = applyTo(v, applyEnterInOrderedList(v, v.length, v.length));
    expect(r).toEqual({ value: "1. 事\n", cursor: "1. 事\n".length });
  });
  it("非列表行返回 null", () => {
    expect(applyEnterInOrderedList("普通行", 3, 3)).toBeNull();
  });
  it("跨行选区按光标前后文本判定续号", () => {
    const v = "1. ab\n2. cd";
    const r = applyTo(v, applyEnterInOrderedList(v, 5, 8)); // 选中 "\n2."
    // beforeLine = "1. ab" 续 "2. "；选区后余文 " cd" 带到新行
    expect(r).toEqual({ value: "1. ab\n2.  cd", cursor: 9 });
  });
  it("有选区时先删除选区再续号", () => {
    const v = "1. abcd";
    const r = applyTo(v, applyEnterInOrderedList(v, 5, 7)); // 选中 "cd"
    expect(r).toEqual({ value: "1. ab\n2. ", cursor: "1. ab\n2. ".length });
  });
  it("空列表项 + 选区跨到行尾，连选区一起清掉", () => {
    const v = "1. xyz\n";
    const r = applyTo(v, applyEnterInOrderedList(v, 3, 6));
    expect(r).toEqual({ value: "\n", cursor: 0 });
  });
});

// C01–C50 边界表：全部为原型（docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/proto.mjs）
// 实跑输出，抄自勘察 2-回车重排算法.md §F，用该文档给出的 parse/run 助手把整张表变成一行一条 case。
// ⌶ 标光标；出现两次 = 选区的 selStart/selEnd。断言最终文本 + 光标，不断言 span
// （最小区间是字节级裁剪，可能切在 token 中间，断言它既难读又脆；C01/C02/C11/C24 另有专门的
// 最小区间断言，见下方 describe）。
const CARET = "⌶";

function parse(marked: string): { value: string; selStart: number; selEnd: number } {
  const first = marked.indexOf(CARET);
  const second = marked.slice(first + 1).indexOf(CARET);
  return {
    value: marked.split(CARET).join(""),
    selStart: first,
    selEnd: second === -1 ? first : first + second,
  };
}

function run(marked: string): string {
  const { value, selStart, selEnd } = parse(marked);
  const e = applyEnterInOrderedList(value, selStart, selEnd);
  if (e?.kind !== "replace") return "NULL";
  const next = value.slice(0, e.start) + e.text + value.slice(e.end);
  return next.slice(0, e.selStart) + CARET + next.slice(e.selStart);
}

const TABLE: [string, string, string][] = [
  ["C01 块尾回车·编号正确", "1. 买菜⌶", "1. 买菜\n2. ⌶"],
  ["C02 块中回车", "1. a\n2. b⌶\n3. c", "1. a\n2. b\n3. ⌶\n4. c"],
  ["C03 块首回车", "1. a⌶\n2. b\n3. c", "1. a\n2. ⌶\n3. b\n4. c"],
  ["C04 单项块·行内余文（护栏）", "3. 前⌶后", "3. 前\n4. ⌶后"],
  ["C05 编号全是 1", "1. a\n1. b⌶\n1. c", "1. a\n2. b\n3. ⌶\n4. c"],
  ["C06 编号乱序 1/5/3", "1. a\n5. b\n3. c⌶", "1. a\n2. b\n3. c\n4. ⌶"],
  [
    "C07 9→10 宽度变化",
    "1. a\n1. b\n1. c\n1. d\n1. e\n1. f\n1. g\n1. h\n1. i⌶\n1. j",
    "1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. ⌶\n11. j",
  ],
  [
    "C08 上方宽度变化推光标",
    "1. a\n1. b\n1. c\n1. d\n1. e\n1. f\n1. g\n1. h\n1. i\n1. j\n1. k⌶",
    "1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. j\n11. k\n12. ⌶",
  ],
  ["C09 空列表项回车清号", "1. 事\n2. ⌶", "1. 事\n⌶"],
  ["C10 空子项清号（含 Tab）", "1. a\n\t1. ⌶", "1. a\n⌶"],
  ["C11 嵌套子项回车", "1. a\n\t1. b⌶", "1. a\n\t1. b\n\t2. ⌶"],
  ["C12 子项后回到父级", "1. a\n\t1. b\n2. c⌶", "1. a\n\t1. b\n2. c\n3. ⌶"],
  ["C13 同行选区", "1. ab⌶cd⌶", "1. ab\n2. ⌶"],
  ["C14 跨行选区", "1. ab⌶\n2.⌶ cd", "1. ab\n2. ⌶ cd"],
  ["C15 光标在 marker 中间", "1.⌶ a", "NULL"],
  ["C16 光标在缩进内", "⌶\t1. a", "NULL"],
  ["C17 非列表行", "普通行⌶", "NULL"],
  ["C18 代码围栏内", "```\n1. a⌶\n```", "NULL"],
  ["C19 围栏在更早处打开", "```js\n1. a\n2. b⌶\n```", "NULL"],
  ["C20 围栏闭合后正常", "```\nx\n```\n1. a\n2. b⌶", "```\nx\n```\n1. a\n2. b\n3. ⌶"],
  ["C21 front-matter 内", "---\ntitle: 1. x⌶\n---\n1. a", "NULL"],
  ["C22 front-matter 之后", "---\ntitle: t\n---\n1. a\n2. b⌶", "---\ntitle: t\n---\n1. a\n2. b\n3. ⌶"],
  ["C23 Tab 与空格混用同级", "1. a\n\t1. b\n    1. c⌶", "1. a\n\t1. b\n    2. c\n    3. ⌶"],
  ["C24 空行分隔的孤项", "1. a\n\n2. b⌶", "1. a\n\n2. b\n3. ⌶"],
  ["C25 续写段落不断块", "1. a\n   续写的一段\n2. b⌶", "1. a\n   续写的一段\n2. b\n3. ⌶"],
  ["C26 无序子项不断块", "1. a\n\t- x\n2. b⌶", "1. a\n\t- x\n2. b\n3. ⌶"],
  ["C27 块后有普通段落", "1. a⌶\n2. b\n\n收尾段落", "1. a\n2. ⌶\n3. b\n\n收尾段落"],
  ["C28 选区跨出块尾", "1. a\n2. b⌶\n\n收尾⌶段落", "1. a\n2. b\n3. ⌶段落"],
  ["C29 圆括号分隔符", "1) a⌶", "NULL"],
  ["C30 marker 后多空格", "1.  a\n2.  b⌶", "1.  a\n2.  b\n3.  ⌶"],
  ["C31 内容空但行内有余文", "1. ⌶abc\n2. d", "1. \n2. ⌶abc\n3. d"],
  ["C32 三级嵌套", "1. a\n\t1. b\n\t\t1. c⌶\n\t2. d\n2. e", "1. a\n\t1. b\n\t\t1. c\n\t\t2. ⌶\n\t2. d\n2. e"],
  ["C33 块紧邻文件头/尾", "1. a\n2. b\n3. c⌶", "1. a\n2. b\n3. c\n4. ⌶"],
  ["C34 单项块·块尾（护栏）", "7. 只有一条⌶", "7. 只有一条\n8. ⌶"],
  ["C35 空格与 Tab 交替", "1. a\n    1. b\n\t1. c⌶", "1. a\n    1. b\n\t2. c\n\t3. ⌶"],
  ["C36 围栏在块中间截断块", "1. a\n```\nx\n```\n2. b⌶", "1. a\n```\nx\n```\n2. b\n3. ⌶"],
  ["C37 未闭合围栏", "```\n1. a\n2. b⌶", "NULL"],
  ["C38 前导零被拉直", "01. a\n02. b⌶", "1. a\n2. b\n3. ⌶"],
  ["C39 整篇只有一个空项", "1. ⌶", "⌶"],
  ["C40 10 位数字", "1234567890. a⌶", "NULL"],
  ["C41 块中清号（下方不重排）", "1. a\n2. b\n3. ⌶\n4. c", "1. a\n2. b\n⌶\n4. c"],
  ["C42 缩进空项在块中清号", "1. a\n\t1. b\n\t2. ⌶\n2. c", "1. a\n\t1. b\n⌶\n2. c"],
  ["C43 光标在行尾换行符前", "1. a⌶\n普通行", "1. a\n2. ⌶\n普通行"],
  ["C44 块首之前是普通段落", "引言\n1. a\n2. b⌶", "引言\n1. a\n2. b\n3. ⌶"],
  ["C45 tilde 围栏", "~~~\n1. a⌶\n~~~", "NULL"],
  ["C46 行内代码不误判围栏", "`` `x` ``\n1. a⌶", "`` `x` ``\n1. a\n2. ⌶"],
  ["C47 缩进围栏（保守）", "1. a\n\t```\n\t1. b⌶\n\t```", "NULL"],
  ["C48 深层后浅一格（退化）", "1. a\n\t\t1. b\n  1. c⌶", "1. a\n\t\t1. b\n  1. c\n  2. ⌶"],
  ["C49 选区覆盖整块", "⌶1. a\n2. b⌶", "NULL"],
  ["C50 gap 是 Tab", "1.\ta\n2.\tb⌶", "1.\ta\n2.\tb\n3.\t⌶"],
];

describe("applyEnterInOrderedList · C01–C50 边界表", () => {
  it.each(TABLE)("%s", (_name, input, expected) => {
    expect(run(input)).toBe(expected);
  });
});

describe("applyEnterInOrderedList · 最小替换区间（只在这几条上断言 span）", () => {
  it("C01：编号本来就对，span 塌成插入点，上下文零字节改动", () => {
    const v = "1. 买菜";
    const e = applyEnterInOrderedList(v, v.length, v.length);
    expect(e).toMatchObject({ kind: "replace", start: 5, end: 5, text: "\n2. " });
  });
  it("C02：块中回车，span 只覆盖光标到块尾", () => {
    const v = "1. a\n2. b\n3. c";
    const e = applyEnterInOrderedList(v, 9, 9);
    expect(e).toMatchObject({ kind: "replace", start: 9, end: 13, text: "\n3. \n4. " });
  });
  it("C11：嵌套子项回车，span 塌成插入点", () => {
    const v = "1. a\n\t1. b";
    const e = applyEnterInOrderedList(v, v.length, v.length);
    expect(e).toMatchObject({ kind: "replace", start: 10, end: 10, text: "\n\t2. " });
  });
  it("C24：loose list 孤项回车，span 塌成插入点（块内仍是两项，护栏不影响这条）", () => {
    const v = "1. a\n\n2. b";
    const e = applyEnterInOrderedList(v, v.length, v.length);
    expect(e).toMatchObject({ kind: "replace", start: 10, end: 10, text: "\n3. " });
  });
});
