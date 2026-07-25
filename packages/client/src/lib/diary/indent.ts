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
  // 硬约束（写进实现注释，不是可讨论的裁决）：targets 为空即返回 null，把焦点交还浏览器——
  // Tab/Shift+Tab 各自都有确定的出口场景，满足 WCAG 2.1.2 键盘陷阱要求存在出口。
  // Tab 的前向出口：非列表行/围栏内（parseItem 在 candidates 过滤阶段就挡掉，走不到这里）、
  // 以及块首行（父行约束 canIndentRows 拒绝——块首行即任意列表的第一项，日记里最常见的位置，
  // 见 T13）。Shift+Tab 的反向出口：顶层列表行（removableIndentLen 判定无缩进可拿，见 T8）。
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
  const outputByLine = new Map<number, { text: string; markerLen: number | null }>();
  for (const bid of touchedBlockIds) {
    const block = blocks[bid];
    const rows: RenumberInputRow[] = block.rows.map((r) => {
      const item = parseItem(lines[r].text);
      if (!item) return { kind: "raw", text: lines[r].text }; // 附属行原样透传，不参与编号
      let indent = item.indent;
      if (targetSet.has(r)) {
        // 前置 Tab（INDENT + indent），不是后置：canIndentRows/listModel.ts 的层级比较全部假设
        // visualCol("\t" + s) === visualCol(s) + TAB_COLUMNS 恒成立，这是前置才有的等式——
        // 后置只在 col 恰好是 4 的倍数时碰巧等于 +4，否则会漂移，且会让 Shift+Tab 的
        // removableIndentLen（认 indent.startsWith(INDENT)）认不出刚加的这个 Tab，Tab→Shift+Tab
        // 就不再互逆。
        indent = dir === "in" ? INDENT + indent : indent.slice(removableIndentLen(indent));
      }
      // numText 传原值即可：straighten=true 会整体覆盖，straighten=false（单项块）会原样使用，
      // 两种情况都要传原值，不能传占位串。
      return { kind: "item", indent, numText: item.numText, gap: item.gap, content: item.content };
    });
    // 单项块护栏（同 orderedList.ts 的 straighten = block.items >= 2）：块内只有 1 个列表项时不拉直，
    // 原样保留用户手写的编号。不加这条，孤立的单项块（loose list 很常见）Shift+Tab/Tab 一下就会被
    // 静默拉直成 "1."，用户手写的号码被吃掉，是我们自己制造的 vault 污染。
    const straighten = block.items >= 2;
    const renumbered = renumberBlock(rows, straighten);
    block.rows.forEach((r, k) => {
      outputByLine.set(r, { text: renumbered[k].text, markerLen: renumbered[k].markerLen });
    });
  }

  const finalTextOf = (i: number): string => outputByLine.get(i)?.text ?? lines[i].text;

  // 替换区间收窄到真正变化的首/末行——这是行级收窄，不是 trimEditSpan 的字节级前后缀裁剪，
  // 也不是复用 orderedList.ts 那套"插入点"逻辑。为什么不能套 trimEditSpan，三点：
  // 1. Tab 天生是行级操作（这一整行往里/往外挪），回车是插入点操作（在光标处拆一行）；权威原型
  //    对 Tab 的实跑结果也是逐行比较找首末变化行，不是字节级前后缀裁剪。
  // 2. trimEditSpan 的 mustCover 参数是为回车量身定做的：回车永远只有一个光标、且这个光标恒在
  //    块内（caret ≥ blockStart）。Tab 有两个端点（选区），且端点可以整体落在改动区间之外
  //    （如选区 [0,10] 而真正的改动区间是 [5,14]，见 T12/本文件的模式 B 平移测试）——硬把
  //    mustCover 塞成"选区端点"，夹逼出来的区间反而比行级扫描算出来的还宽，字节级"更窄"的
  //    卖点在这里不成立。两者会给出不同答案（字节级会切得更碎，如把 "3. C"→"2. C" 只换开头的
  //    "3"→"2"），但 T1/T12/T17 等边界表条目要求的是"整行替换、行内容原样"的粒度。
  // 3. "口径不一致"（Tab 用行级、回车用字节级）不构成问题：撤销条目由每次按键调一次
  //    execCommand 决定，与区间宽窄无关；saveDiary 是整篇内容 PUT，编辑区间根本不出客户端，
  //    409 冲突判定看的是 mtime 不看内容差。
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
    // 不 re-parse newLineText 反解 markerLen（listModel.ts renumberBlock 的 JSDoc 明确禁止这么做：
    // 这条坑在 Task 4 的随机用例里实测造成 1.9% 光标错位）；renumberBlock 已经把 markerLen 直接
    // 算出来，这里从上面存的 outputByLine 里原样取用。
    const newPre = outputByLine.get(i)?.markerLen ?? 0;
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
