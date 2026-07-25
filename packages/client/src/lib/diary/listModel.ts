// 日记编辑器共享行模型与有序列表重排原语。
// 这是回车整段重排（§4.2）与 Tab 缩进（§4.3）唯一准用的一份实现——两处各写一套是本阶段
// 最大的架构风险，详见 docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/2-回车重排算法.md。
// 假设：输入 value 来自 textarea.value，按 HTML 规范换行已归一为 LF（"\n"）；
// 本模块只服务 textarea，不处理 CRLF。

/** Tab 制表位宽度：展开 Tab 时推进到下一个 4 的倍数，不是简单 +4。 */
export const TAB_COLUMNS = 4;

/** 写入用的缩进单元，写死不做设置项。 */
export const INDENT = "\t";

/**
 * 有序列表项正则。四点变化，逐条见勘察 §A：
 * - `([ \t]*)` 捕获前导缩进（Tab/空格混用的存量文件都要认）；
 * - `\d{1,9}` 上限 9 位，防 `Number()` 溢出；代价是超长数字被当普通行（功能不生效，不是改坏文件）；
 * - `([ \t]+)` 允许多空格/Tab 作为 gap，且原样保留、新行继承；
 * - 只认 `.` 不认 `)`，与现状一致。
 */
export const ITEM_RE = /^([ \t]*)(\d{1,9})\.([ \t]+)(.*)$/;

/** 代码围栏行识别；缩进用 `[ \t]*` 而非 CommonMark 的 `{0,3}` 空格——偏保守，见 scanProtected 注释。 */
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})(.*)$/;

/** 行首空白探测，供 assignBlocks 判定"附属行"用。 */
const LEADING_WS_RE = /^[ \t]*/;

/** 一行的物理位置。index 是 0 基行号；start/end 是行首/行尾（不含 "\n"）在 value 中的绝对偏移。 */
export interface DocLine {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** 解析成功的有序列表项。所有字段都保存原文字节，重排只换 numText。 */
export interface OrderedItem {
  /** 前导缩进原文，可能是 "\t"、"    "、"\t  " 混合。 */
  indent: string;
  /** indent 展开 Tab 后的视觉列宽（唯一的层级比较键，见 visualCol）。 */
  col: number;
  /** 编号原文，可能带前导零（如 "01"）。 */
  numText: string;
  /** 分隔符与内容之间的空白原文（" " / "  " / "\t"），原样保留。 */
  gap: string;
  /** marker 之后的全部内容。 */
  content: string;
  /** indent.length + numText.length + 1(分隔符 ".") + gap.length。 */
  markerLen: number;
}

/** assignBlocks 产出的一个连续列表块。rows 同时含项行与附属行（按文档序）。 */
export interface Block {
  id: number;
  rows: number[];
  /** 块内"真正的"列表项行数，不含附属行。 */
  items: number;
  /** 扫描过程中最近一个列表项的视觉列宽，供判定后续附属行使用。 */
  lastItemCol: number;
}

/** 按 "\n" 切分为带绝对偏移的行数组。用 indexOf 循环而非 split，需要每行的绝对 offset。 */
export function splitLines(value: string): DocLine[] {
  const lines: DocLine[] = [];
  let start = 0;
  let index = 0;
  for (;;) {
    const nl = value.indexOf("\n", start);
    if (nl === -1) {
      lines.push({ index, start, end: value.length, text: value.slice(start) });
      return lines;
    }
    lines.push({ index, start, end: nl, text: value.slice(start, nl) });
    start = nl + 1;
    index += 1;
  }
}

/**
 * indent 展开 Tab 后的视觉列宽，即制表位语义：Tab 把列宽推进到下一个 TAB_COLUMNS 的倍数，
 * 不是简单 +TAB_COLUMNS。`visualCol("  \t")` = 4（两个空格后的 Tab 仍到 4，不是 6）。
 */
export function visualCol(indent: string): number {
  let col = 0;
  for (const ch of indent) {
    if (ch === "\t") col += TAB_COLUMNS - (col % TAB_COLUMNS);
    else col += 1;
  }
  return col;
}

/** 解析一行是否是有序列表项；不是则返回 null（含 marker 用 `)` 分隔、10 位以上数字等情形）。 */
export function parseItem(text: string): OrderedItem | null {
  const m = ITEM_RE.exec(text);
  if (!m) return null;
  const [, indent, numText, gap, content] = m;
  return {
    indent,
    col: visualCol(indent),
    numText,
    gap,
    content,
    markerLen: indent.length + numText.length + 1 + gap.length,
  };
}

/**
 * 扫描 front-matter 与代码围栏保护位，必须从文件头单遍扫描——只看局部块看不到更早打开的围栏，
 * 反例：光标所在的列表行前面隔着几行才是真正的 ```` ``` ````，只看块内会误判成正常列表去改写，
 * 改坏 vault 里的代码块。front-matter 未闭合、围栏未闭合都保守保护到文件尾（宁可功能不生效，
 * 不可改坏文件）。实测代价：4000 行文档单次 0.276ms，真实日记规模 0.068ms，不需要缓存。
 */
export function scanProtected(lines: DocLine[]): boolean[] {
  const prot = new Array(lines.length).fill(false);
  let i = 0;
  if (lines.length > 0 && lines[0].text === "---") {
    let j = 1;
    while (j < lines.length && lines[j].text !== "---" && lines[j].text !== "...") j += 1;
    const close = j < lines.length ? j : lines.length - 1; // 未闭合：保守保护到文件尾
    for (let k = 0; k <= close; k += 1) prot[k] = true;
    i = close + 1;
  }
  let fence: { ch: string; len: number } | null = null;
  for (; i < lines.length; i += 1) {
    const t = lines[i].text;
    const m = FENCE_RE.exec(t);
    if (fence) {
      prot[i] = true;
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === "") fence = null;
      continue;
    }
    if (m) {
      const ch = m[1][0];
      // 反引号且 info string 含反引号（如行内代码 `` `x` ``）→ 不当作围栏开启，避免误开。
      if (ch === "`" && m[2].includes("`")) continue;
      fence = { ch, len: m[1].length };
      prot[i] = true;
    }
  }
  return prot;
}

/**
 * 单遍前向扫描给每行分配块 id：-1 = 不属于任何有序列表块。
 * 附属行规则（知情偏离，见 §C.1）：非列表行但视觉列宽 > 块内最近一项的 col → 并入本块、
 * 不参与计数（items 不 +1）、字节原样保留。不加这条会把 "1. a / \t- x（无序子项） / 2. b"
 * 在无序子项处断块，"2. b" 自成一块被拉直成 "1. b"——用户毫无感觉但文件已经改坏。
 */
export function assignBlocks(lines: DocLine[], prot: boolean[]): { blockOf: number[]; blocks: Block[] } {
  const blockOf: number[] = new Array(lines.length).fill(-1);
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].text;
    if (prot[i] || t.trim() === "") {
      cur = null;
      continue;
    }
    const item = parseItem(t);
    if (item) {
      if (!cur) {
        cur = { id: blocks.length, rows: [], items: 0, lastItemCol: item.col };
        blocks.push(cur);
      }
      cur.lastItemCol = item.col;
      cur.items += 1;
      cur.rows.push(i);
      blockOf[i] = cur.id;
      continue;
    }
    const leading = LEADING_WS_RE.exec(t)?.[0] ?? "";
    if (cur && visualCol(leading) > cur.lastItemCol) {
      cur.rows.push(i); // 附属行：续写段落 / 无序子项，块不断、不计数
      blockOf[i] = cur.id;
      continue;
    }
    cur = null;
  }
  return { blockOf, blocks };
}

/**
 * 层级 = 单调栈相对深度，不是 col / TAB_COLUMNS：存量文件里子项可能缩 2 格或 3 格，除不尽。
 * 出层时把更深的计数器整体丢弃；入层时新计数器从 0 起；同层继续累加，不重置。
 */
export function expectedNumbers(cols: number[]): number[] {
  const stack: { col: number; n: number }[] = [];
  return cols.map((col) => {
    while (stack.length > 0 && col < stack[stack.length - 1].col) stack.pop();
    if (stack.length === 0 || col > stack[stack.length - 1].col) stack.push({ col, n: 0 });
    const top = stack[stack.length - 1];
    top.n += 1;
    return top.n;
  });
}

/**
 * 拉直一个块内的编号。straighten=false 时原样返回（一个字节不动）——"当前号+1"这类单项块护栏
 * 逻辑属于插入新行的语义，由调用方（Task 4）在喂给这里之前就决定好，不在本函数职责内。
 * straighten=true 时按 expectedNumbers 重新计算每个列表项的编号，indent/gap/content 一律不动。
 * 非列表行（附属行）原样透传。
 */
export function renumberBlock(rows: string[], straighten: boolean): string[] {
  if (!straighten) return rows.slice();
  const parsed = rows.map((r) => parseItem(r));
  const itemIndices: number[] = [];
  const cols: number[] = [];
  parsed.forEach((it, idx) => {
    if (it) {
      itemIndices.push(idx);
      cols.push(it.col);
    }
  });
  const nums = expectedNumbers(cols);
  const out = rows.slice();
  itemIndices.forEach((rowIdx, k) => {
    const it = parsed[rowIdx];
    if (!it) return;
    out[rowIdx] = `${it.indent}${nums[k]}.${it.gap}${it.content}`;
  });
  return out;
}

/**
 * 整块新文本 → 前后缀裁剪，得最小替换区间，再夹逼到包住 mustCover（通常是光标）。
 * 编号本来就正确时，裁剪后区间自然塌成插入点，上下文一个字节不动。
 */
export function trimEditSpan(
  oldText: string,
  newText: string,
  base: number,
  mustCover: number,
): { start: number; end: number; text: string } {
  const oldLen = oldText.length;
  const newLen = newText.length;
  let p = 0;
  while (p < oldLen && p < newLen && oldText[p] === newText[p]) p += 1;
  let s = 0;
  while (s < oldLen - p && s < newLen - p && oldText[oldLen - 1 - s] === newText[newLen - 1 - s]) s += 1;
  let start = base + p;
  let end = base + oldLen - s;
  if (start > mustCover) start = mustCover; // 防御性夹逼：区间必须包住 mustCover
  if (end < mustCover) end = mustCover;
  const text = newText.slice(start - base, newLen - (base + oldLen - end));
  return { start, end, text };
}

/**
 * Tab 缩进的"父行约束"判定输入（4-键位语义.md §1.4）。isTarget = 这次操作打算缩进的候选
 * （通常是选区触及的列表行）；非候选行只用于把"上方最近列表行"的列宽往前推进。
 */
export interface IndentCandidateRow {
  /** 该行是否是有序列表项。非列表行/空行会切断"上方最近列表行"链。 */
  isListItem: boolean;
  /** 该行当前（缩进前）的视觉列宽；非列表行时忽略。 */
  col: number;
  /** 该行是否是这次 Tab 操作打算缩进的目标行。 */
  isTarget: boolean;
}

/**
 * 父行约束批量判定：朴素地在行首插 `\t` 会生成被 markdown 渲染成 indented code block 的文本——
 * 把用户的列表项静默变成代码块。两条约束，自上而下逐行累积判定，用"已处理行的新深度"而非原深度：
 * 1. 目标行在同块内必须存在上方最近的列表行（非列表行/空行会切断该链）；不存在（= 块首行）→ 不可缩进。
 * 2. 目标行原深度 ≤ 上方最近列表行的新深度；否则（已经比上一行深）→ 不可缩进，防跳级。
 * 输入须是同一个块内、按文档序排列的行；调用方（Task 5）不需要再自己写这套累积逻辑。
 */
export function canIndentRows(rows: IndentCandidateRow[]): boolean[] {
  const result: boolean[] = new Array(rows.length).fill(false);
  let nearestCol: number | null = null; // 上方最近列表行的"新"列宽
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.isListItem) {
      nearestCol = null; // 非列表行/空行切断链
      continue;
    }
    if (!row.isTarget) {
      nearestCol = row.col; // 非目标列表行不缩进，新深度 = 原深度
      continue;
    }
    const allowed: boolean = nearestCol !== null && row.col <= nearestCol;
    result[i] = allowed;
    nearestCol = allowed ? row.col + TAB_COLUMNS : row.col;
  }
  return result;
}
