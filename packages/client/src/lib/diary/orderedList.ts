// 有序列表回车重排：把整块从当前项到块尾一次性拉直编号（而不是只改当前行 +1）。
// 假设：输入 value 来自 textarea.value，按 HTML 规范换行已归一为 LF（"\n"）；
// 本函数只服务 textarea，不处理 CRLF。
// 算法与边界表见 docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/2-回车重排算法.md
// §D（伪代码）/ §E（光标公式）/ §F（C01–C50 边界表，本文件的测试直接抄自那张表）。
// 行模型 / 保护位扫描 / 分块 / 重排原语全部来自 listModel.ts，本文件只写"回车语义"这一层：
// 判定当前行是否可续号、拆出插入的新行、决定拉不拉直、把重排结果收敛成最小编辑区间。

import {
  assignBlocks,
  type DocLine,
  lineIndexAt,
  parseItem,
  removableIndentLen,
  type RenumberInputRow,
  renumberBlock,
  scanProtected,
  splitLines,
  trimEditSpan,
} from "./listModel.js";
import type { EditAction } from "./textareaEdit.js";

/**
 * 把"当前行 i 被替换成 replacement 这几行"落成一个最小编辑描述符：整块重排 → 前后缀裁剪 →
 * 算光标 → 映射回 value 坐标系。回车的两条分支（续号拆行 / 空项出层）唯一的区别就是 replacement
 * 里放什么，其余逐字相同——分成两份写过一次，结果是出层分支漏抄了光标公式里"编号位数变化可能
 * 发生在光标上方"那半条，块内有 9→10 跨位数时光标落错。
 *
 * @param cursorSlot 光标落在 replacement 的第几行（0 基）。
 */
function rebuildBlockAround(params: {
  work: string;
  lines: DocLine[];
  prot: boolean[];
  i: number;
  caret: number;
  /** 选区宽度（selEnd - selStart）：替换区间映射回 value 坐标系时要补回来。 */
  shift: number;
  replacement: RenumberInputRow[];
  cursorSlot: number;
}): EditAction {
  const { work, lines, prot, i, caret, shift, replacement, cursorSlot } = params;

  const { blockOf, blocks } = assignBlocks(lines, prot);
  const block = blocks[blockOf[i]];
  const blockStart = lines[block.rows[0]].start;
  const blockEnd = lines[block.rows[block.rows.length - 1]].end;
  const oldBlock = work.slice(blockStart, blockEnd);

  // 单项块护栏（知情偏离，见勘察 §0 裁决 6）：块内只有 1 个列表项时不拉直，保留用户手写的编号。
  // 不加这条，loose list（"1. a\n\n2. b"）里的 "2. b" 会被孤立分块后改写成 "1. b"，
  // 用户毫无感觉但文件已经坏了。判据用**原块**的项数：出层分支不新增行，续号分支新增的那行
  // 是本次操作的产物，都不该反过来影响"这个块本来算不算多项列表"。
  const straighten = block.items >= 2;

  // 造出"块的新样子"：当前行换成 replacement，其余行原样透传（item 走结构化字段，raw 走透传），
  // 交给 renumberBlock 统一重排——不能自己拼字符串再让它去解析（见 listModel.ts RenumberItemRow
  // 的 JSDoc：gap 是贪婪匹配，回车带到新行的余文若以空白开头会被吞进 gap）。
  const rows: RenumberInputRow[] = [];
  let cursorRow = -1;
  for (const r of block.rows) {
    if (r === i) {
      cursorRow = rows.length + cursorSlot;
      rows.push(...replacement);
      continue;
    }
    const rowLine = lines[r];
    const rowItem = parseItem(rowLine.text);
    rows.push(
      rowItem
        ? { kind: "item", indent: rowItem.indent, numText: rowItem.numText, gap: rowItem.gap, content: rowItem.content }
        : { kind: "raw", text: rowLine.text },
    );
  }

  const renumbered = renumberBlock(rows, straighten);
  const out = renumbered.map((r) => r.text);
  const newBlock = out.join("\n");
  const cursorMarkerLen = renumbered[cursorRow].markerLen ?? 0;

  // 最小替换区间 = 前后缀裁剪，编号本来就对时自然塌成插入点（需求 3 与需求 5 的统一解）。
  const span = trimEditSpan(oldBlock, newBlock, blockStart, caret);

  // 光标：不能用"旧光标+增量"算——宽度漂移可以发生在光标上方（块内前面的项从 9→10 位数变化）。
  // 必须用 blockStart + 新块内目标行之前所有行的长度和 + 该行重排后的 markerLen（勘察 §E）。
  let cursorOffset = 0;
  for (let idx = 0; idx < cursorRow; idx += 1) cursorOffset += out[idx].length + 1;
  const cursor = blockStart + cursorOffset + cursorMarkerLen;

  // 映射回 value 坐标系：start <= caret 的偏移不变，end >= caret 的偏移 +shift
  // （选区必然被替换区间整体覆盖，见勘察 §D 末尾的证明）。
  return {
    kind: "replace",
    start: span.start <= caret ? span.start : span.start + shift,
    end: span.end >= caret ? span.end + shift : span.end,
    text: span.text,
    selStart: cursor,
    selEnd: cursor,
  };
}

/**
 * 在有序列表中处理回车键。
 * @param value 完整文本
 * @param selStart 选区起点（光标或选区左端）
 * @param selEnd 选区终点（光标或选区右端）
 * @returns 返回 null 表示不处理（交还浏览器默认行为）；否则返回编辑描述符（交给 runEditAction 落到 textarea 上）
 */
export function applyEnterInOrderedList(value: string, selStart: number, selEnd: number): EditAction | null {
  // 0. 选区先在"虚拟文本"上删掉，之后全部逻辑只面对"一个光标"的世界（勘察 §D 开头的理由）。
  const shift = selEnd - selStart;
  const work = shift === 0 ? value : value.slice(0, selStart) + value.slice(selEnd);
  const caret = selStart;

  const lines = splitLines(work);
  const prot = scanProtected(lines);
  const i = lineIndexAt(lines, caret);
  if (prot[i]) return null; // 围栏内 / front-matter 内 → 放行原生回车

  const line = lines[i];
  const item = parseItem(line.text);
  if (!item) return null;
  const caretInLine = caret - line.start;
  if (caretInLine < item.markerLen) return null; // 光标在缩进/编号/gap 内部 → 放行

  const contentBefore = line.text.slice(item.markerLen, caretInLine);
  const restOfLine = line.text.slice(caretInLine); // 行内光标之后的余文，要带到新行

  // 空列表项回车 → 逐级出层：这一项还有缩进可拿就先退一层（编号按新层级整块重排），退到顶层
  // 再按一次才清行。与 Notion / Typora / Obsidian 一致，也是写嵌套清单时唯一顺手的走法。
  //
  // 原语义是"任何深度的空项回车都直接清掉整行（含缩进）"。它在二级上的实际表现是：那行连缩进
  // 一起消失、变成一行纯空行，而空行既不是列表项也没有缩进，于是紧接着按 Tab 想救回来时
  // applyIndent 的候选行过滤直接放行、焦点跳去下一个可聚焦元素（宽屏下正是分栏拖拽把手）。
  // 用户看到的是"回车吐出一行没序号的行、Tab 还会乱跳"。
  if (contentBefore === "" && restOfLine === "") {
    const outdentLen = removableIndentLen(item.indent);
    // 顶层空项：保留原语义，清空整行。注意用外层参数 selEnd（原坐标），等价于现状的
    // slice(0,lineStart)+slice(selEnd)：line.start 在 value/work 两个坐标系下相同
    // （line.start <= caret = selStart，块首之前从不被选区删除触碰），selEnd 是原坐标系里
    // 选区右端，两者直接拼在一起既清掉行前缀又顺带删掉选区，不需要额外 shift 换算。
    if (outdentLen === 0) {
      return { kind: "replace", start: line.start, end: selEnd, text: "", selStart: line.start, selEnd: line.start };
    }
    // 退一层后编号交给整块重排定（expectedNumbers 的单调栈会把它算成新层级的下一项），
    // 这里传原 numText 只为单项块护栏那条路径（straighten=false 时原样使用）。
    return rebuildBlockAround({
      work,
      lines,
      prot,
      i,
      caret,
      shift,
      replacement: [
        { kind: "item", indent: item.indent.slice(outdentLen), numText: item.numText, gap: item.gap, content: "" },
      ],
      cursorSlot: 0,
    });
  }

  // 当前行截断成 before/after 两条 item。新行继承当前行的缩进与 gap；numText 填"当前号+1"，
  // straighten=true 时会被 renumberBlock 整体覆盖，straighten=false（单项块）时它就是最终值，
  // 两种情况下都不用另填占位串。
  return rebuildBlockAround({
    work,
    lines,
    prot,
    i,
    caret,
    shift,
    replacement: [
      { kind: "item", indent: item.indent, numText: item.numText, gap: item.gap, content: contentBefore },
      {
        kind: "item",
        indent: item.indent,
        numText: String(Number(item.numText) + 1),
        gap: item.gap,
        content: restOfLine,
      },
    ],
    cursorSlot: 1,
  });
}
