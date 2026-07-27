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

/**
 * assignBlocks 产出的一个连续列表块。rows 同时含项行与附属行（按文档序）。
 * 不含"最近一个列表项列宽"这类扫描游标——那是 assignBlocks 内部状态，扫描结束后它的语义会
 * 退化成"块内最后一项的列宽"，对消费者没用还容易被误当成"块的层级信息"用错（见 §E.7）。
 */
export interface Block {
  id: number;
  rows: number[];
  /** 块内"真正的"列表项行数，不含附属行。 */
  items: number;
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

/**
 * 一次"出层"能从 indent 前面拿掉多少个字符：indent 以 INDENT（"\t"）开头就拿掉 1 个 Tab 字符；
 * 否则视为空格缩进的老文件，最多拿掉 TAB_COLUMNS 个前导空格（不足则有多少拿多少）。
 * 返回 0 表示该行已经是顶层（无缩进可拿）。
 *
 * 两个消费者共用同一份定义，不许各写一套：Shift+Tab 出层（`indent.ts`）据此判定"这一行还能不能
 * 再出一层"，空列表项回车的逐级出层（`orderedList.ts`）据此判定"这次回车是退一层还是清行"。
 * 两处若分叉，会出现 Shift+Tab 认为还能出层、回车却认为已经到顶（或反过来）的自相矛盾。
 */
export function removableIndentLen(indent: string): number {
  if (indent.startsWith(INDENT)) return INDENT.length;
  let n = 0;
  while (n < TAB_COLUMNS && indent[n] === " ") n += 1;
  return n;
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
  let lastItemCol = 0; // 扫描游标：当前块内最近一个列表项的视觉列宽；不进 Block（见 Block 注释）
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].text;
    if (prot[i] || t.trim() === "") {
      cur = null;
      continue;
    }
    const item = parseItem(t);
    if (item) {
      if (!cur) {
        cur = { id: blocks.length, rows: [], items: 0 };
        blocks.push(cur);
      }
      lastItemCol = item.col;
      cur.items += 1;
      cur.rows.push(i);
      blockOf[i] = cur.id;
      continue;
    }
    const leading = LEADING_WS_RE.exec(t)?.[0] ?? "";
    if (cur && visualCol(leading) > lastItemCol) {
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
 * renumberBlock 的一行输入。分 "item"（列表项，indent/numText/gap/content 拆开传）与
 * "raw"（附属行，原样透传、不参与编号）。
 *
 * item 行必须拆开传，不能先拼成整行字符串再让本函数解析：新插入行的 content 可能以空白开头
 * （如 "1. 买菜⌶ 和做饭" 回车后，新行 content=" 和做饭"），一旦拼接成整行，ITEM_RE 的
 * `([ \t]+)` 贪婪匹配会把 content 的前导空白也吞进 gap——拼接后的整行文本字节不变（gap 与
 * content 只是同一段空白的两种切法，两种切法拼回去是同一个字符串），但由此反解出的 gap.length
 * 会多算，markerLen 也就多算，直接导致光标落错位置。这正是本函数存在的原因。
 */
export interface RenumberItemRow {
  kind: "item";
  indent: string;
  /** straighten=false 时原样使用；straighten=true 时会被整体覆盖，传什么都无所谓。 */
  numText: string;
  gap: string;
  content: string;
}

/** 附属行 / 本次不参与编号的行，原样透传，两种模式下 markerLen 恒为 null。 */
export interface RenumberRawRow {
  kind: "raw";
  text: string;
}

export type RenumberInputRow = RenumberItemRow | RenumberRawRow;

/** renumberBlock 的一行输出。 */
export interface RenumberedRow {
  text: string;
  /** item 行是最终 marker（indent+numText+"."+gap）的长度；raw 行恒为 null。 */
  markerLen: number | null;
}

/**
 * 拉直一个块内的编号，返回每行的最终文本与 marker 长度。Task 4 算光标要用
 * `cursor = blockStart + newLineOffset + newLineMarkerLen`，而 newLineMarkerLen（新插入行拉直
 * 之后的 marker 长度）只有拉直完成后才知道，只能由本函数直接交出——调用方不该、也不能靠
 * re-parse 输出的 text 反解 markerLen（见 RenumberItemRow 的 JSDoc；这条坑在实测中造成
 * 49437 组随机用例里 1.9% 光标错位），本函数内部同样不 re-parse 任何字符串，markerLen 永远从
 * indent/numText/gap 的长度直接相加算出。
 *
 * straighten=false 时：item 行的 numText 原样使用（调用方已在喂进来之前算好，如"当前号+1"的
 * 单项块护栏语义），只据此重新拼出 text 与 markerLen，indent/gap/content 一律不动。
 * straighten=true 时：按 visualCol(indent) + expectedNumbers 重新计算每个 item 行的编号，传入
 * 的 numText 无所谓写什么（会被整体覆盖）。
 * raw 行两种模式下都原样透传。
 */
export function renumberBlock(rows: RenumberInputRow[], straighten: boolean): RenumberedRow[] {
  if (!straighten) {
    return rows.map((r) => {
      if (r.kind === "raw") return { text: r.text, markerLen: null };
      const text = `${r.indent}${r.numText}.${r.gap}${r.content}`;
      const markerLen = r.indent.length + r.numText.length + 1 + r.gap.length;
      return { text, markerLen };
    });
  }
  const itemCols = rows.filter((r): r is RenumberItemRow => r.kind === "item").map((r) => visualCol(r.indent));
  const nums = expectedNumbers(itemCols);
  let k = 0;
  return rows.map((r) => {
    if (r.kind === "raw") return { text: r.text, markerLen: null };
    const numText = String(nums[k]);
    k += 1;
    const text = `${r.indent}${numText}.${r.gap}${r.content}`;
    const markerLen = r.indent.length + numText.length + 1 + r.gap.length;
    return { text, markerLen };
  });
}

/**
 * 整块新文本 → 前后缀裁剪，得最小替换区间，再夹逼到包住 mustCover（通常是光标）。
 * 编号本来就正确时，裁剪后区间自然塌成插入点，上下文一个字节不动。
 *
 * 前置条件（未写明但必须满足）：mustCover >= base。mustCover 通常是光标/选区端点的绝对偏移，
 * base 是 oldText 在文档中的起始绝对偏移；`newText.slice(start - base, …)` 在 start < base 时
 * 走负索引会产出垃圾（如 `trimEditSpan("abc","axc",10,3)` 不夹逼会切出无意义的区间）。Task 4
 * 天然满足（caret ≥ blockStart），这里仍显式把 mustCover 夹逼到 base，不静默产出错误区间——
 * Tab 缩进路径（Task 5）改用行级区间、不调用本函数，理由见 `indent.ts` 里的注释。
 */
export function trimEditSpan(
  oldText: string,
  newText: string,
  base: number,
  mustCover: number,
): { start: number; end: number; text: string } {
  if (mustCover < base) mustCover = base; // 前置条件夹逼，见上方 JSDoc
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
 * 由字符偏移定位行号（Task 4/5 都要用："这个光标/选区端点落在第几行"）。
 * caret === lines[i].end（行尾换行符之前）判给第 i 行，caret === lines[i+1].start（下一行行首）
 * 判给第 i+1 行，无歧义——勘察报告 C43 专门实测过的边界，两个任务各写一遍容易分叉，收进共享
 * 行模型里只写一遍。
 */
export function lineIndexAt(lines: DocLine[], offset: number): number {
  let i = 0;
  while (i < lines.length - 1 && offset > lines[i].end) i += 1;
  return i;
}

/**
 * Tab 缩进的"父行约束"批量判定（4-键位语义.md §1.4）。调用方只需给出这次操作想缩进哪些行的
 * 行号（targetLines，可来自选区覆盖的列表行，不要求同块/连续），不需要自己翻译"这一行算不算
 * 附属行"——本函数从文件头单遍前向扫描 lines，行的角色判定与 assignBlocks 用同一份依据
 * （blockOf[i] === -1 才断链），保证两者的块边界理解永远一致。
 *
 * 历史教训（务必读）：早期版本让调用方传 `{ isListItem, col, isTarget }[]`，用 isListItem:false
 * 表示"非列表行切断链"；但 assignBlocks 明确规定"缩进更深的非列表行是附属行、不断块"——两条
 * 规则对同一份文本给出相反的块边界。"1. a\n   续写的一段\n2. b" 这种日记里极常见的写法会被
 * 误判成 "2. b" 是块首行、Tab 被错误放行、焦点跳出编辑器。现在直接吃 assignBlocks 算出的
 * blockOf，附属行判定不可能再分叉。
 *
 * 两条约束，自上而下用"已处理行的新深度"（而非原深度）逐行累积判定：
 * 1. 目标行在同块内必须存在上方最近的列表项（blockOf[i]===-1 才切断该链；附属行既不断链也
 *    不推进"最近列表项"列宽，直接跳过）；不存在（= 块首行）→ 不可缩进。
 * 2. 目标行原深度 ≤ 上方最近列表项的新深度；否则（已经比上一行深）→ 不可缩进，防跳级。
 *
 * 返回值与 targetLines 一一对应（不是与 lines 等长）；非目标/非列表项/附属行不在 targetLines
 * 里没有意义，若仍传入统一按 false 处理。
 */
export function canIndentRows(lines: DocLine[], blockOf: number[], targetLines: number[]): boolean[] {
  const targetSet = new Set(targetLines);
  const resultByLine = new Map<number, boolean>();
  let nearestCol: number | null = null; // 上方最近列表项的"新"列宽
  for (let i = 0; i < lines.length; i += 1) {
    if (blockOf[i] === -1) {
      nearestCol = null; // 真正的块边界（空行/受保护行/不深于最近项的普通行）才断链
      continue;
    }
    const item = parseItem(lines[i].text);
    if (!item) continue; // 附属行：既不断链也不推进 nearestCol，本身也不可能是 Tab 目标
    if (targetSet.has(i)) {
      const allowed: boolean = nearestCol !== null && item.col <= nearestCol;
      resultByLine.set(i, allowed);
      // 用"新深度"而非原深度：+TAB_COLUMNS 隐含 INDENT === "\t"（visualCol("\t"+s) ===
      // visualCol(s)+TAB_COLUMNS 恒成立），将来若改缩进单元这里要同步改。
      nearestCol = allowed ? item.col + TAB_COLUMNS : item.col;
    } else {
      nearestCol = item.col; // 非目标列表项不缩进，新深度 = 原深度
    }
  }
  return targetLines.map((line) => resultByLine.get(line) ?? false);
}
