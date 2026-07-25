import { describe, expect, it } from "vitest";
import {
  assignBlocks,
  canIndentRows,
  expectedNumbers,
  parseItem,
  renumberBlock,
  scanProtected,
  splitLines,
  trimEditSpan,
  visualCol,
} from "./listModel.js";

describe("visualCol", () => {
  it("Tab 推进到下一个制表位而不是简单 +4", () => {
    expect(visualCol("\t")).toBe(4);
    expect(visualCol("  \t")).toBe(4); // 2 空格后一个 Tab 仍到 4，不是 6
    expect(visualCol("    ")).toBe(4);
    expect(visualCol("\t\t")).toBe(8);
  });
  it("空缩进列宽为 0", () => {
    expect(visualCol("")).toBe(0);
  });
  it("Tab 后接空格按普通字符 +1 累加", () => {
    expect(visualCol("\t  ")).toBe(6); // 4 + 1 + 1
  });
});

describe("expectedNumbers（单调栈相对深度）", () => {
  it("Tab 与空格混用的同级项被正确认成兄弟", () => {
    // 这条是层级裁决的核心：按字符串长度算会得到 [1,1,1]（把 c 当成 b 的子项）
    expect(expectedNumbers([0, 4, 4])).toEqual([1, 1, 2]);
  });
  it("出层后父级继续数，不重置", () => {
    expect(expectedNumbers([0, 4, 4, 0])).toEqual([1, 1, 2, 2]);
  });
  it("三级嵌套", () => {
    expect(expectedNumbers([0, 4, 8, 4, 0])).toEqual([1, 1, 1, 2, 2]);
  });
  it("比父深比兄浅的退化情形当作新开一层", () => {
    expect(expectedNumbers([0, 4, 2])).toEqual([1, 1, 1]);
  });
  it("空数组返回空数组", () => {
    expect(expectedNumbers([])).toEqual([]);
  });
});

describe("parseItem", () => {
  it("捕获前导缩进与可变 gap，原样保留", () => {
    expect(parseItem("\t1.  内容")).toMatchObject({ indent: "\t", numText: "1", gap: "  ", content: "内容" });
  });
  it("10 位数字不认（防溢出）", () => {
    expect(parseItem("1234567890. a")).toBeNull();
  });
  it("圆括号分隔符不认", () => {
    expect(parseItem("1) a")).toBeNull();
  });
  it("markerLen 由 indent/numText/gap 拼出，不是硬编码 +2", () => {
    const item = parseItem("  10.   abc");
    expect(item).not.toBeNull();
    // indent(2) + numText(2="10") + "."(1) + gap(3) = 8
    expect(item?.markerLen).toBe(8);
    expect(item?.content).toBe("abc");
  });
  it("前导零原样保留在 numText 里", () => {
    expect(parseItem("01. a")).toMatchObject({ numText: "01" });
  });
  it("9 位数字仍可解析", () => {
    expect(parseItem("123456789. a")).toMatchObject({ numText: "123456789" });
  });
});

describe("splitLines", () => {
  it("空字符串产出单行、绝对偏移与 index 正确", () => {
    expect(splitLines("")).toEqual([{ index: 0, start: 0, end: 0, text: "" }]);
  });
  it("多行文本每行都有正确的 index/start/end", () => {
    const lines = splitLines("1. a\n2. b\n3. c");
    expect(lines).toEqual([
      { index: 0, start: 0, end: 4, text: "1. a" },
      { index: 1, start: 5, end: 9, text: "2. b" },
      { index: 2, start: 10, end: 14, text: "3. c" },
    ]);
  });
  it("末尾换行符会产出一个空的末行", () => {
    const lines = splitLines("a\n");
    expect(lines).toEqual([
      { index: 0, start: 0, end: 1, text: "a" },
      { index: 1, start: 2, end: 2, text: "" },
    ]);
  });
});

describe("scanProtected", () => {
  it("代码围栏必须从文件头识别，块内看不见也要保护", () => {
    const lines = splitLines("```js\n1. a\n2. b\n```");
    expect(scanProtected(lines)[2]).toBe(true);
  });
  it("未闭合围栏保守保护到文件尾", () => {
    const lines = splitLines("```\n1. a\n2. b");
    expect(scanProtected(lines).every(Boolean)).toBe(true);
  });
  it("front-matter 区域受保护，其后不受", () => {
    const lines = splitLines("---\ntitle: 1. x\n---\n1. a");
    const prot = scanProtected(lines);
    expect(prot[1]).toBe(true);
    expect(prot[3]).toBe(false);
  });
  it("行内代码不误开围栏", () => {
    const lines = splitLines("`x`\n1. a");
    expect(scanProtected(lines)[1]).toBe(false);
  });
  it("front-matter 未闭合保守保护到文件尾", () => {
    const lines = splitLines("---\ntitle: t\n1. a\n2. b");
    expect(scanProtected(lines).every(Boolean)).toBe(true);
  });
  it("tilde 围栏同样支持", () => {
    const lines = splitLines("~~~\n1. a\n~~~");
    expect(scanProtected(lines)[1]).toBe(true);
    expect(scanProtected(lines)[2]).toBe(true);
  });
  it("围栏闭合后的行不再受保护", () => {
    const lines = splitLines("```\nx\n```\n1. a\n2. b");
    const prot = scanProtected(lines);
    expect(prot[3]).toBe(false);
    expect(prot[4]).toBe(false);
  });
  it("缩进围栏也认（保守：误开的代价是功能不生效，漏判的代价是改坏代码块）", () => {
    const lines = splitLines("1. a\n\t```\n\t1. b\n\t```");
    const prot = scanProtected(lines);
    expect(prot[2]).toBe(true);
  });
});

describe("assignBlocks", () => {
  it("续写段落作为附属行并入块、不参与计数、字节原样保留", () => {
    const lines = splitLines("1. a\n   续写的一段\n2. b");
    const prot = scanProtected(lines);
    const { blockOf, blocks } = assignBlocks(lines, prot);
    expect(blockOf).toEqual([0, 0, 0]); // 三行同属一块
    expect(blocks[0].rows).toEqual([0, 1, 2]);
    expect(blocks[0].items).toBe(2); // 只有两个真正的列表项
  });
  it("无序子项作为附属行不断块", () => {
    const lines = splitLines("1. a\n\t- x\n2. b");
    const prot = scanProtected(lines);
    const { blockOf, blocks } = assignBlocks(lines, prot);
    expect(blockOf).toEqual([0, 0, 0]);
    expect(blocks[0].items).toBe(2);
  });
  it("空行断块，产生两个独立块", () => {
    const lines = splitLines("1. a\n\n1. b");
    const prot = scanProtected(lines);
    const { blockOf, blocks } = assignBlocks(lines, prot);
    expect(blockOf).toEqual([0, -1, 1]);
    expect(blocks).toHaveLength(2);
  });
  it("受保护行不计入任何块，且切断块", () => {
    const lines = splitLines("1. a\n```\nx\n```\n2. b");
    const prot = scanProtected(lines);
    const { blockOf, blocks } = assignBlocks(lines, prot);
    expect(blockOf[1]).toBe(-1);
    expect(blockOf[2]).toBe(-1);
    expect(blockOf[3]).toBe(-1);
    expect(blocks).toHaveLength(2); // "1. a" 与 "2. b" 各自成块
    expect(blockOf[0]).not.toBe(blockOf[4]);
  });
  it("缩进不深于块内最近一项的非列表行断块（不是附属行）", () => {
    const lines = splitLines("1. a\n普通行\n2. b");
    const prot = scanProtected(lines);
    const { blockOf, blocks } = assignBlocks(lines, prot);
    expect(blockOf).toEqual([0, -1, 1]);
    expect(blocks).toHaveLength(2);
  });
});

describe("renumberBlock", () => {
  it("straighten=true 按视觉列宽重新拉直编号，indent/gap/content 原样保留", () => {
    const rows = ["1. a", "\t1. b", "    1. c"]; // c 缩进 4 空格，与 b 的 Tab 视觉同级
    expect(renumberBlock(rows, true)).toEqual(["1. a", "\t1. b", "    2. c"]);
  });
  it("straighten=false 原样返回，一个字节不动", () => {
    const rows = ["7. a", "9. b"];
    expect(renumberBlock(rows, false)).toEqual(rows);
    expect(renumberBlock(rows, false)).not.toBe(rows); // 返回新数组，不是同一引用
  });
  it("附属行（非列表项文本）在拉直时原样透传", () => {
    const rows = ["1. a", "   续写的一段", "5. b"];
    expect(renumberBlock(rows, true)).toEqual(["1. a", "   续写的一段", "2. b"]);
  });
  it("前导零在拉直时丢失（拉直的一部分）", () => {
    expect(renumberBlock(["01. a", "02. b"], true)).toEqual(["1. a", "2. b"]);
  });
  it("gap 原样保留（多空格/ Tab）", () => {
    expect(renumberBlock(["1.  a", "5.  b"], true)).toEqual(["1.  a", "2.  b"]);
    expect(renumberBlock(["1.\ta", "5.\tb"], true)).toEqual(["1.\ta", "2.\tb"]);
  });
});

describe("trimEditSpan", () => {
  it("首尾相同时裁剪成最小插入点", () => {
    const oldText = "1. a\n2. b";
    const newText = "1. a\n2. b\n3. ";
    const span = trimEditSpan(oldText, newText, 100, 109);
    // 公共前缀 = 整个 oldText，公共后缀为空 → 插入点在 100+9=109
    expect(span).toEqual({ start: 109, end: 109, text: "\n3. " });
  });
  it("mustCover 之前的区间不会被裁到超出 mustCover 右侧", () => {
    const span = trimEditSpan("abc", "axc", 0, 1);
    expect(span.start).toBeLessThanOrEqual(1);
    expect(span.end).toBeGreaterThanOrEqual(1);
    expect(span.text).toBe("x");
  });
  it("防御性夹逼：mustCover 落在旧区间之外时区间被撑大到包住它", () => {
    // oldText/newText 完全相同（无差异），自然裁剪结果是块尾的零宽插入点 [3,3)；
    // mustCover=5 在这之外（如选区删除后光标落在块尾之后），end 被夹逼撑到 5。
    const span = trimEditSpan("abc", "abc", 0, 5);
    expect(span).toEqual({ start: 3, end: 5, text: "" });
  });
});

describe("canIndentRows（父行约束）", () => {
  it("块首行不可缩进（没有上方列表行）", () => {
    // "1. A\n2. B\n3. C" 选中前两行 Tab：A 是块首行，不可缩进
    const rows = [
      { isListItem: true, col: 0, isTarget: true }, // A
      { isListItem: true, col: 0, isTarget: true }, // B
      { isListItem: true, col: 0, isTarget: false }, // C
    ];
    expect(canIndentRows(rows)).toEqual([false, true, false]);
  });
  it("已经比上一行深时不可缩进（防跳级）", () => {
    // "1. A\n\t2. B\n3. C" 光标在 B，再按一次 Tab：B 原深度 4 > A 的新深度 0，不可缩进
    const rows = [
      { isListItem: true, col: 0, isTarget: false }, // A
      { isListItem: true, col: 4, isTarget: true }, // B
      { isListItem: true, col: 0, isTarget: false }, // C
    ];
    expect(canIndentRows(rows)).toEqual([false, false, false]);
  });
  it("同层第二个子项可以再缩进一级", () => {
    // "1. A\n\t1. b1\n\t2. b2" 光标在 b2：b2 原深度 4 == b1 的新深度 4，可以缩进
    const rows = [
      { isListItem: true, col: 0, isTarget: false }, // A
      { isListItem: true, col: 4, isTarget: false }, // b1
      { isListItem: true, col: 4, isTarget: true }, // b2
    ];
    expect(canIndentRows(rows)).toEqual([false, false, true]);
  });
  it("非列表行/空行切断「上方最近列表行」链", () => {
    const rows = [
      { isListItem: true, col: 0, isTarget: false }, // A
      { isListItem: false, col: 0, isTarget: false }, // 空行/普通行，切断链
      { isListItem: true, col: 0, isTarget: true }, // 新块块首行
    ];
    expect(canIndentRows(rows)).toEqual([false, false, false]);
  });
  it("全部候选行都不满足约束时整体返回全 false（调用方据此放行 Tab）", () => {
    const rows = [{ isListItem: true, col: 0, isTarget: true }];
    expect(canIndentRows(rows)).toEqual([false]);
  });
});
