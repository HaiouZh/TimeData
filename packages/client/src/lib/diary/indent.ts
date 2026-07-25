// 日记编辑器 Tab / Shift+Tab 缩进出层。
// 权威语义见 docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/4-键位语义.md 第一部分（§1.1–§1.9），
// 边界表（T1–T20）全部原型实跑产出，本文件的测试直接抄自那张表（indent.test.ts）。
// 行模型 / 保护位扫描 / 分块 / 重排 / 父行约束全部来自 listModel.ts，本文件只写"Tab 语义"这一层：
// 判定哪些行是"这次操作真的能动"的目标、把目标行的缩进加一级/减一级、决定重排范围、把结果收敛
// 成最小（行级）编辑区间。

import {
  assignBlocks,
  canIndentRows,
  INDENT,
  lineIndexAt,
  parseItem,
  type RenumberInputRow,
  renumberBlock,
  scanProtected,
  splitLines,
  TAB_COLUMNS,
} from "./listModel.js";
import type { EditAction } from "./textareaEdit.js";

/**
 * Shift+Tab 每次能拿掉多少缩进：indent 以 INDENT（"\t"）开头就拿掉 1 个 Tab 字符；
 * 否则视为空格缩进的老文件，最多拿掉 TAB_COLUMNS 个前导空格（不足则有多少拿多少）。
 * 返回 0 表示该行已经是顶层（无缩进可拿），调用方据此把它排除出 targets——
 * 这正是"Shift+Tab 在顶层放行"的判定依据（§1.3）。
 */
function removableIndentLen(indent: string): number {
  if (indent.startsWith(INDENT)) return INDENT.length;
  let n = 0;
  while (n < TAB_COLUMNS && indent[n] === " ") n += 1;
  return n;
}

/**
 * Tab / Shift+Tab 缩进出层。
 * @param value 完整文本
 * @param selStart 选区起点（光标或选区左端）
 * @param selEnd 选区终点（光标或选区右端）
 * @param dir "in" = Tab 缩进一级；"out" = Shift+Tab 出层一级
 * @returns 返回 null 表示不处理（交还浏览器默认行为：Tab 跳焦 / Shift+Tab 反向跳焦）；
 *          否则返回编辑描述符（交给 runEditAction 落到 textarea 上）。
 *
 * 判定"这一行算不算列表行"看整行本身，与光标在行内哪一列无关（缩进区/marker 中间/行尾/空列表项
 * 都算）——这与回车的判定不同（回车语义是"续写 marker"，Tab 语义是"这一整行往里挪"），不能照搬
 * applyEnterInOrderedList 只看光标前文本的写法（§1.2）。
 */
export function applyIndent(value: string, selStart: number, selEnd: number, dir: "in" | "out"): EditAction | null {
  const lines = splitLines(value);
  const prot = scanProtected(lines); // 代码围栏 / front-matter：直接复用，不另写扫描器
  const { blockOf, blocks } = assignBlocks(lines, prot);

  const fi = lineIndexAt(lines, selStart);
  // 选区末端恰落在下一行行首时，那一行不算被选中（拖选到行尾天然带上换行符，不该多缩一行，§1.5）。
  let endProbe = selEnd;
  if (selEnd > selStart) {
    const probeLine = lineIndexAt(lines, selEnd);
    if (lines[probeLine].start === selEnd) endProbe = selEnd - 1;
  }
  const li = lineIndexAt(lines, endProbe);

  // 候选行：选区覆盖、未受保护、且本身是有序列表项的行。围栏/front-matter 内的行即使长得像
  // "1. x" 也不进候选——扫描器已经把它们的 blockOf 钉成 -1，这里提前过滤只是少做无意义的工作。
  const candidates: number[] = [];
  for (let i = fi; i <= li; i += 1) {
    if (prot[i]) continue;
    if (parseItem(lines[i].text)) candidates.push(i);
  }
  if (candidates.length === 0) return null; // 全是非列表行/受保护行 → 放行

  let targets: number[];
  if (dir === "in") {
    // 父行约束（M2 移植）：块首行、或已经比上一行深的行不可缩进——不加这条，朴素插 \t 会把该行
    // 静默变成被 markdown 渲染成 indented code block 的文本，正是我们自己制造的 vault 污染。
    const allowed = canIndentRows(lines, blockOf, candidates);
    targets = candidates.filter((_, k) => allowed[k]);
  } else {
    // 出层不受父行约束（出层永远安全），只要该行还有缩进可拿即可。
    targets = candidates.filter((i) => {
      const item = parseItem(lines[i].text);
      return item !== null && removableIndentLen(item.indent) > 0;
    });
  }
  // 硬约束（写进实现注释，不是可讨论的裁决）：本页正文几乎全是有序列表，Tab 在列表行一律被吃掉，
  // 前向逃生口实际不存在——targets 为空即返回 null 放行，是 Shift+Tab 在顶层列表行走通的唯一路径
  // （WCAG 2.1.2 键盘陷阱要求存在某个出口）。这一分支同时覆盖 Tab 在非列表行/围栏内放行的情形。
  // 将来若有人以"对称性"为由想让 Shift+Tab 也在顶层被吃掉（出到顶再继续出层），那会真的把两个
  // 方向同时封死，构成键盘陷阱——不要改。
  if (targets.length === 0) return null;

  const targetSet = new Set(targets);
  const touchedBlockIds = new Set(targets.map((i) => blockOf[i]));

  // 被触及的块可能不止一个（如两个由空行分隔的独立列表块各自被 Tab 命中，§1.7 例 3 / T17）；
  // bs/be 是这些块各自 rows 范围的并集边界，只用来限定下面重排扫描的范围，不直接当替换区间。
  let bs = Number.POSITIVE_INFINITY;
  let be = Number.NEGATIVE_INFINITY;
  for (const bid of touchedBlockIds) {
    const block = blocks[bid];
    bs = Math.min(bs, block.rows[0]);
    be = Math.max(be, block.rows[block.rows.length - 1]);
  }

  // 逐块重排：块内每一行（含附属行）都要经过 renumberBlock，因为缩进目标行的深度变化会级联影响
  // 同块内后续行的编号（如 depth0 的第 2 项被缩进成子项后，depth0 的第 3 项要顺势改叫第 2 项）。
  // 缩进/出层本身只动目标行的 indent；不带子树——子项原样留在原深度，这是明确的取舍（§1.7 例 3），
  // 不是 bug：带子树要引入"子树"概念与额外用户预期，而多行选中一起缩已经用行级操作覆盖了这个需求。
  const outputByLine = new Map<number, string>();
  for (const bid of touchedBlockIds) {
    const block = blocks[bid];
    const rows: RenumberInputRow[] = block.rows.map((r) => {
      const item = parseItem(lines[r].text);
      if (!item) return { kind: "raw", text: lines[r].text }; // 附属行原样透传，不参与编号
      let indent = item.indent;
      if (targetSet.has(r)) {
        indent = dir === "in" ? indent + INDENT : indent.slice(removableIndentLen(indent));
      }
      // numText 传原值即可：straighten=true 会整体覆盖，这里只是凑齐字段形状。
      return { kind: "item", indent, numText: item.numText, gap: item.gap, content: item.content };
    });
    const renumbered = renumberBlock(rows, true);
    block.rows.forEach((r, k) => {
      outputByLine.set(r, renumbered[k].text);
    });
  }

  const finalTextOf = (i: number): string => outputByLine.get(i) ?? lines[i].text;

  // 替换区间收窄到真正变化的首/末行——这是行级收窄，不是 trimEditSpan 的字节级前后缀裁剪。
  // 两者会给出不同的答案（字节级会切得更碎，如把 "3. C"→"2. C" 只换开头的 "3"→"2"），但 T1/T12/T17
  // 等边界表条目要求的是"整行替换、行内容原样"的粒度，所以这里手写行级扫描，不强行套 trimEditSpan
  // （它的 mustCover 前置条件也未必总能满足，见 listModel.ts 的 JSDoc）。
  let rowFirst = -1;
  let rowLast = -1;
  for (let i = bs; i <= be; i += 1) {
    if (finalTextOf(i) !== lines[i].text) {
      if (rowFirst === -1) rowFirst = i;
      rowLast = i;
    }
  }
  if (rowFirst === -1) return null; // 防御性：targets 非空理论上必有变化，这里不应该到达

  const outSpanLines: string[] = [];
  for (let i = rowFirst; i <= rowLast; i += 1) outSpanLines.push(finalTextOf(i));
  const newSpanText = outSpanLines.join("\n");
  const spanStart = lines[rowFirst].start;
  const spanEnd = lines[rowLast].end;
  const delta = newSpanText.length - (spanEnd - spanStart);

  const newStarts: number[] = [];
  {
    let acc = spanStart;
    for (const l of outSpanLines) {
      newStarts.push(acc);
      acc += l.length + 1;
    }
  }

  // 行号 → 新文档里的绝对起点/文本，覆盖三种情形：改动区间之前（原样不动）、改动区间内（按
  // newStarts 重算）、改动区间之后（整体平移 delta）。选区端点（模式 B）可能落在改动区间之外
  // （如 T12 的 fi=0 早于真正开始改动的行），必须靠这套通用映射才能算对，不能只处理区间内的点。
  function newLineStartOf(j: number): number {
    if (j < rowFirst) return lines[j].start;
    if (j > rowLast) return lines[j].start + delta;
    return newStarts[j - rowFirst];
  }
  function newLineTextOf(j: number): string {
    if (j < rowFirst || j > rowLast) return lines[j].text;
    return outSpanLines[j - rowFirst];
  }

  let ns: number;
  let ne: number;
  if (selStart === selEnd) {
    // 模式 A（无选区）：按"距内容起点的偏移"映射。落在 marker 内一律吸到内容起点（同时解决宽度
    // 漂移：9.→10. 之类的编号宽度变化直接体现在 newPre-oldPre 里，不能写死 +1（§1.5 / T14）。
    const i = fi; // fi === li（无选区时单点必落在同一行）
    const oldPre = parseItem(lines[i].text)?.markerLen ?? 0;
    const newLineText = newLineTextOf(i);
    const newPre = parseItem(newLineText)?.markerLen ?? 0;
    const col = selStart - lines[i].start;
    const newCol = col > oldPre ? col + (newPre - oldPre) : newPre;
    const pos = newLineStartOf(i) + Math.min(newCol, newLineText.length);
    ns = pos;
    ne = pos;
  } else {
    // 模式 B（有选区）：整行化对齐——选中范围收敛成"覆盖同样这几行的整行选区"，不与模式 A 的
    // 逐字符映射公式合并（两种模式的意图不同，硬凑一个公式两边都会算错，§1.5 明确要求分开写）。
    ns = newLineStartOf(fi);
    ne = newLineStartOf(li) + newLineTextOf(li).length;
  }

  return {
    kind: "replace",
    start: spanStart,
    end: spanEnd,
    text: newSpanText,
    selStart: ns,
    selEnd: ne,
  };
}
