import { describe, expect, it } from "vitest";
import {
  assignBlocks,
  canIndentRows,
  expectedNumbers,
  lineIndexAt,
  normalizeIndent,
  parseItem,
  removableIndentLen,
  type RenumberInputRow,
  type RenumberItemRow,
  type RenumberRawRow,
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

describe("lineIndexAt", () => {
  const lines = splitLines("1. a\n2. b\n3. c"); // [0,4] [5,9] [10,14]

  it("偏移落在行首", () => {
    expect(lineIndexAt(lines, 0)).toBe(0);
  });
  it("偏移落在行中", () => {
    expect(lineIndexAt(lines, 7)).toBe(1); // "2. b" 内部
  });
  it("偏移落在行尾换行符之前，判给该行（C43）", () => {
    expect(lineIndexAt(lines, 9)).toBe(1); // "2. b" 的 end，不是 "3. c" 的行首
  });
  it("偏移落在下一行行首，判给下一行（与上一条相差 1 的无歧义边界）", () => {
    expect(lineIndexAt(lines, 10)).toBe(2); // "3. c" 的 start
  });
  it("偏移落在文件末尾", () => {
    expect(lineIndexAt(lines, 14)).toBe(2);
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
    // 单个反引号 `x` 根本匹配不上 FENCE_RE（要求 `{3,}），连守卫都碰不到；
    // 换成三反引号包住的行内代码，才真正触达"info string 含反引号 → 不开围栏"这条守卫。
    const lines = splitLines("```x```\n1. a");
    expect(scanProtected(lines)).toEqual([false, false]);
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
  it('关闭行去除空白后必须为空，否则视为未闭合（m[2].trim() === ""）', () => {
    // "``` extra" 长得像收尾围栏，但收尾行只能有围栏字符+空白，不能有额外内容——
    // 否则整篇会一直被判定为"未闭合"保护到文件尾。
    const lines = splitLines("```\n1. a\n``` extra\n2. b");
    expect(scanProtected(lines).every(Boolean)).toBe(true);
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
  it("纯空白行（非真空串）同样断块", () => {
    // 与上一条测的是同一个 t.trim() === "" 分支，但用行尾留空格这种极常见的真实输入，
    // 能区分出 "t.trim() === \"\"" 与误写成 "t === \"\"" 的变异。
    const lines = splitLines("1. a\n   \n2. b");
    const prot = scanProtected(lines);
    const { blockOf } = assignBlocks(lines, prot);
    expect(blockOf).toEqual([0, -1, 1]);
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
  it("缩进围栏内看起来像列表项的行不会被误认成附属行（prot[i] 分支）", () => {
    // "\t5. b" 本身能被 parseItem 正常解析成有效列表项，若不靠 prot 挡住，会被
    // assignBlocks 的附属行规则（视觉列宽 > 最近项 col）误吞进 "1. a" 所在的块，
    // 之后拉直编号会把围栏里的代码改写成 "\t1. b"——这正是要防的"改坏 vault 代码块"。
    const lines = splitLines("1. a\n\t```\n\t5. b\n\t```\n2. c");
    const prot = scanProtected(lines);
    const { blockOf, blocks } = assignBlocks(lines, prot);
    expect(blockOf).toEqual([0, -1, -1, -1, 1]);
    expect(blocks).toHaveLength(2);
  });
});

describe("renumberBlock", () => {
  function item(text: string): RenumberItemRow {
    const it = parseItem(text);
    if (!it) throw new Error(`不是有效列表项: ${text}`);
    return { kind: "item", indent: it.indent, numText: it.numText, gap: it.gap, content: it.content };
  }
  function raw(text: string): RenumberRawRow {
    return { kind: "raw", text };
  }

  it("straighten=true 按视觉列宽重新拉直编号，indent/gap/content 原样保留，并交出重算后的 markerLen", () => {
    const rows = [item("1. a"), item("\t1. b"), item("    1. c")]; // c 缩进 4 空格，与 b 的 Tab 视觉同级
    expect(renumberBlock(rows, true)).toEqual([
      { text: "1. a", markerLen: 3 }, // "" + "1" + "." + " "
      { text: "\t1. b", markerLen: 4 }, // "\t" + "1" + "." + " "
      { text: "    2. c", markerLen: 7 }, // "    " + "2" + "." + " "
    ]);
  });
  it("straighten=false 时 numText 原样使用，markerLen 据此算出", () => {
    const rows = [item("7. a"), item("9. b")];
    expect(renumberBlock(rows, false)).toEqual([
      { text: "7. a", markerLen: 3 },
      { text: "9. b", markerLen: 3 },
    ]);
  });
  it("附属行（raw）在拉直时原样透传，markerLen 恒为 null", () => {
    const rows: RenumberInputRow[] = [item("1. a"), raw("   续写的一段"), item("5. b")];
    expect(renumberBlock(rows, true)).toEqual([
      { text: "1. a", markerLen: 3 },
      { text: "   续写的一段", markerLen: null },
      { text: "2. b", markerLen: 3 },
    ]);
  });
  it("前导零在拉直时丢失（拉直的一部分）", () => {
    const rows = [item("01. a"), item("02. b")];
    expect(renumberBlock(rows, true)).toEqual([
      { text: "1. a", markerLen: 3 },
      { text: "2. b", markerLen: 3 },
    ]);
  });
  it("gap 原样保留（多空格/Tab），markerLen 把 gap 的真实长度算进去", () => {
    expect(renumberBlock([item("1.  a"), item("5.  b")], true)).toEqual([
      { text: "1.  a", markerLen: 4 },
      { text: "2.  b", markerLen: 4 },
    ]);
    expect(renumberBlock([item("1.\ta"), item("5.\tb")], true)).toEqual([
      { text: "1.\ta", markerLen: 3 },
      { text: "2.\tb", markerLen: 3 },
    ]);
  });

  describe("markerLen 不靠 re-parse（回归 A）", () => {
    it("straighten=true：content 以空白开头的新插入行，markerLen 依然正确", () => {
      // 对应 "1. 买菜⌶ 和做饭" 回车产生的新行：content=" 和做饭"（前导空格），gap=" "。
      // 若靠 re-parse 输出行反解 markerLen，ITEM_RE 的贪婪 gap 会把 content 的前导空格也吞
      // 进去，markerLen 多算 1，光标就会落在空格右边而不是左边（"2.  ⌶和做饭" 而不是
      // "2. ⌶ 和做饭"）。
      const rows: RenumberInputRow[] = [
        { kind: "item", indent: "", numText: "1", gap: " ", content: "买菜" },
        { kind: "item", indent: "", numText: "?", gap: " ", content: " 和做饭" },
      ];
      const out = renumberBlock(rows, true);
      expect(out[1]).toEqual({ text: "2.  和做饭", markerLen: 3 }); // "2." + " "(gap)，不含 content 的前导空格
    });
    it("straighten=false：同样不受影响（numText 原样使用）", () => {
      const rows: RenumberInputRow[] = [
        { kind: "item", indent: "", numText: "1", gap: " ", content: "买菜" },
        { kind: "item", indent: "", numText: "2", gap: " ", content: " 和做饭" },
      ];
      const out = renumberBlock(rows, false);
      expect(out[1]).toEqual({ text: "2.  和做饭", markerLen: 3 });
    });
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
  it("块中回车：起点夹逼与后缀扫描的 p 夹逼同时生效（真实场景，非契约外输入）", () => {
    // "1. a\n2. b\n3. c" 在第 3 行回车（光标在行尾之后、新块 "3. \n4. c" 已经拉直）：
    // 自然裁剪出的最小区间起点在 13，但光标（mustCover=9）在它之前，需要把起点夹逼回 9；
    // 这同时钉住"后缀扫描不能越过前缀 p" —— 若后缀扫描的上界从 oldLen-p 放宽成 oldLen，
    // 会一路扫穿前缀区，算出 end < start 的倒挂区间。
    const oldText = "1. a\n2. b\n3. c";
    const newText = "1. a\n2. b\n3. \n4. c";
    expect(trimEditSpan(oldText, newText, 0, 9)).toEqual({ start: 9, end: 13, text: "\n3. \n4. " });
  });
  it("mustCover < base 时被夹逼到 base（未写明的前置条件，防止负索引产出垃圾）", () => {
    const span = trimEditSpan("abc", "axc", 10, 3); // mustCover(3) < base(10)
    expect(span.start).toBeGreaterThanOrEqual(10);
  });
});

describe("canIndentRows（父行约束，与 assignBlocks 共用块边界）", () => {
  function setup(text: string) {
    const lines = splitLines(text);
    const prot = scanProtected(lines);
    const { blockOf } = assignBlocks(lines, prot);
    return { lines, blockOf };
  }

  it("块首行不可缩进（没有上方列表行）", () => {
    // "1. A\n2. B\n3. C" 选中前两行 Tab：A 是块首行，不可缩进；B 可以
    const { lines, blockOf } = setup("1. A\n2. B\n3. C");
    expect(canIndentRows(lines, blockOf, [0, 1])).toEqual([false, true]);
  });
  it("已经比上一行深时不可缩进（防跳级）", () => {
    // "1. A\n\t2. B\n3. C" 光标在 B，再按一次 Tab：B 原深度 4 > A 的新深度 0，不可缩进
    const { lines, blockOf } = setup("1. A\n\t2. B\n3. C");
    expect(canIndentRows(lines, blockOf, [1])).toEqual([false]);
  });
  it("同层第二个子项可以再缩进一级", () => {
    // "1. A\n\t1. b1\n\t2. b2" 光标在 b2：b2 原深度 4 == b1 的新深度 4，可以缩进
    const { lines, blockOf } = setup("1. A\n\t1. b1\n\t2. b2");
    expect(canIndentRows(lines, blockOf, [2])).toEqual([true]);
  });
  it("真正的块边界（空行）切断「上方最近列表行」链", () => {
    const { lines, blockOf } = setup("1. A\n\n1. C");
    expect(canIndentRows(lines, blockOf, [2])).toEqual([false]); // C 是新块块首行
  });
  it("单行且无上方列表行时不可缩进（调用方据此放行 Tab）", () => {
    const { lines, blockOf } = setup("1. a");
    expect(canIndentRows(lines, blockOf, [0])).toEqual([false]);
  });

  it("【回归 B】附属行（续写段落）不切断链——与 assignBlocks 的块划分保持一致", () => {
    // 这是本次修复要根治的 bug：旧实现里非列表行一律当块边界，与 assignBlocks 的附属行规则
    // 矛盾，"1. a\n   续写的一段\n2. b" 这种全日记最常见的写法会把 "2. b" 误判成块首行，
    // Tab 被错误放行，焦点跳出编辑器。现在两者共用同一份 blockOf，不可能再分叉。
    const { lines, blockOf } = setup("1. a\n   续写的一段\n2. b");
    expect(canIndentRows(lines, blockOf, [2])).toEqual([true]);
  });
  it("附属行本身若被误当作目标行，返回 false（它不是列表项）", () => {
    const { lines, blockOf } = setup("1. a\n   续写的一段\n2. b");
    expect(canIndentRows(lines, blockOf, [1])).toEqual([false]);
  });
  it("【回归】用「新深度」推进 nearestCol，不是原深度", () => {
    // 4-键位语义.md §1.4 特意加粗的一条：B 被允许缩进后，后续判定要用 B 缩进后的新列宽（4），
    // 不是它原来的列宽（0）；否则 C（col 4）会被误判成"比新深度更深"而不可缩进（变异版会给出
    // [false, true, false]，把 C 拉平成 B 的兄弟）。
    const { lines, blockOf } = setup("1. A\n2. B\n\t1. C");
    expect(canIndentRows(lines, blockOf, [0, 1, 2])).toEqual([false, true, true]);
  });
});

// 全角字符放宽（2026-07-27）。全角一律用 \uXXXX 转义写：U+00A0 与普通空格肉眼无从分辨，
// 写字面量的话这些用例迟早被 formatter 或后来的人静默改成半角、从此永远绿。
const FW_SPACE = "\u3000"; // 全角空格
const NB_SPACE = "\u00a0"; // 不间断空格
const FW_1 = "\uff11"; // 全角数字 1
const FW_2 = "\uff12";
const CN_DOT = "\u3002"; // 中文句号
const FW_DOT = "\uff0e"; // 全角句点

describe("parseItem · 四个位置认全角", () => {
  it("缩进用全角空格也认得出是列表项", () => {
    const item = parseItem(`${FW_SPACE}1. a`);
    expect(item).not.toBeNull();
    expect(item?.col).toBe(2); // 全角空格占两列
  });
  it("编号用全角数字也认得出", () => {
    expect(parseItem(`${FW_1}${FW_2}. a`)?.numText).toBe(`${FW_1}${FW_2}`);
  });
  it("分隔符用中文句号 / 全角句点也认得出", () => {
    expect(parseItem(`1${CN_DOT} a`)).not.toBeNull();
    expect(parseItem(`1${FW_DOT} a`)).not.toBeNull();
  });
  it("gap 用全角空格也认得出，markerLen 按原文字符数算", () => {
    const item = parseItem(`1.${FW_SPACE}a`);
    expect(item?.content).toBe("a");
    expect(item?.markerLen).toBe(3); // "1" + "." + 一个全角空格
  });
  it("四个位置全是全角也认得出", () => {
    const item = parseItem(`${FW_SPACE}${FW_1}${CN_DOT}${FW_SPACE}内容`);
    expect(item?.content).toBe("内容");
  });
  it("仍然不认 `)` 分隔符与 10 位以上数字（放宽没有顺手放开别的）", () => {
    expect(parseItem("1) a")).toBeNull();
    expect(parseItem("1234567890. a")).toBeNull();
  });
});

describe("visualCol / normalizeIndent · 等宽替换", () => {
  it("全角空格算两列，与两个半角空格同层", () => {
    expect(visualCol(FW_SPACE)).toBe(2);
    expect(visualCol(FW_SPACE)).toBe(visualCol("  "));
  });
  it("不间断空格算一列", () => {
    expect(visualCol(NB_SPACE)).toBe(1);
  });
  it("规范化前后视觉列宽恒等（否则回车会顺手改掉嵌套层级）", () => {
    for (const indent of [FW_SPACE, NB_SPACE, `${FW_SPACE}${FW_SPACE}`, `\t${FW_SPACE}`, `${NB_SPACE} \t`, "  "]) {
      expect(visualCol(normalizeIndent(indent))).toBe(visualCol(indent));
    }
  });
  it("规范化后不再含全角空白（这才是让 Obsidian 也认它是列表的那一步）", () => {
    expect(normalizeIndent(`${FW_SPACE}${NB_SPACE}`)).toBe("   ");
  });
});

describe("removableIndentLen · 按视觉列宽出层", () => {
  it("全角空格按列宽拿：两个全角空格 = 4 列 = 一级", () => {
    expect(removableIndentLen(`${FW_SPACE}${FW_SPACE}`)).toBe(2);
  });
  it("一个全角空格不足一级，有多少拿多少", () => {
    expect(removableIndentLen(FW_SPACE)).toBe(1);
  });
  it("半角空格行为不变（4 个拿 4，2 个拿 2）", () => {
    expect(removableIndentLen("    ")).toBe(4);
    expect(removableIndentLen("  ")).toBe(2);
  });
  it("Tab 优先，仍然只拿一个 Tab 字符", () => {
    expect(removableIndentLen(`\t${FW_SPACE}`)).toBe(1);
  });
  it("顶层仍返回 0（Shift+Tab 的逃生口判据没被放宽破坏）", () => {
    expect(removableIndentLen("")).toBe(0);
    expect(removableIndentLen("abc")).toBe(0);
  });
});

describe("renumberBlock · marker 规范成半角", () => {
  const item = (indent: string, numText: string, gap: string, content: string): RenumberInputRow => ({
    kind: "item",
    indent,
    numText,
    gap,
    content,
  });

  it("全角编号被拉直成半角，不产出 NaN", () => {
    const out = renumberBlock([item("", FW_1, " ", "a"), item("", FW_2, " ", "b")], true);
    expect(out.map((r) => r.text)).toEqual(["1. a", "2. b"]);
  });
  it("不拉直（单项块）时也半角化，保留原号数值", () => {
    const out = renumberBlock([item("", `${FW_1}${FW_2}`, " ", "a")], false);
    expect(out[0].text).toBe("12. a");
    expect(out[0].text).not.toContain("NaN");
  });
  it("全角缩进与全角 gap 一并规范，markerLen 跟着新文本算", () => {
    const out = renumberBlock([item(FW_SPACE, "1", FW_SPACE, "a")], false);
    expect(out[0].text).toBe("  1. a"); // 缩进等宽换成两个半角空格，gap 收成一个半角空格
    expect(out[0].markerLen).toBe(5);
  });
  it("raw 行原样透传，不被规范化碰到", () => {
    const raw: RenumberRawRow = { kind: "raw", text: `${FW_SPACE}续写的一段` };
    expect(renumberBlock([item("", "1", " ", "a"), raw], false)[1].text).toBe(`${FW_SPACE}续写的一段`);
  });
});

describe("assignBlocks · 附属行的行首空白口径同步放宽", () => {
  it("全角空格缩进的续写段落算附属行，不把块截断", () => {
    // LEADING_WS_RE 与 ITEM_RE 用同一份 WS_CLASS。它若漏了全角，"　　　续写"会被判成
    // 普通行、在这里断块，下面的 "2. b" 自成一块被拉直成 "1. b"——用户毫无感觉但文件已经改坏。
    const text = `1. a\n${FW_SPACE}${FW_SPACE}${FW_SPACE}续写的一段\n2. b`;
    const lines = splitLines(text);
    const { blocks } = assignBlocks(lines, scanProtected(lines));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].items).toBe(2); // 附属行不计入 items
    expect(blocks[0].rows).toEqual([0, 1, 2]);
  });
});
