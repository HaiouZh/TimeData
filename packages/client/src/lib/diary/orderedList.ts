// 有序列表回车重排：把整块从当前项到块尾一次性拉直编号（而不是只改当前行 +1）。
// 假设：输入 value 来自 textarea.value，按 HTML 规范换行已归一为 LF（"\n"）；
// 本函数只服务 textarea，不处理 CRLF。
// 算法与边界表见 docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/2-回车重排算法.md
// §D（伪代码）/ §E（光标公式）/ §F（C01–C50 边界表，本文件的测试直接抄自那张表）。
// 行模型 / 保护位扫描 / 分块 / 重排原语全部来自 listModel.ts，本文件只写"回车语义"这一层：
// 判定当前行是否可续号、拆出插入的新行、决定拉不拉直、把重排结果收敛成最小编辑区间。

import {
  assignBlocks,
  lineIndexAt,
  parseItem,
  type RenumberInputRow,
  renumberBlock,
  scanProtected,
  splitLines,
  trimEditSpan,
} from "./listModel.js";
import type { EditAction } from "./textareaEdit.js";

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

  // 空列表项回车 → 清号（保留现状语义，含缩进一并删）。注意用外层参数 selEnd（原坐标），
  // 等价于现状的 slice(0,lineStart)+slice(selEnd)：line.start 在 value/work 两个坐标系
  // 下相同（line.start <= caret = selStart，块首之前从不被选区删除触碰），selEnd 是原
  // 坐标系里选区右端，两者直接拼在一起既清掉行前缀又顺带删掉选区，不需要额外 shift 换算。
  if (contentBefore === "" && restOfLine === "") {
    return { kind: "replace", start: line.start, end: selEnd, text: "", selStart: line.start, selEnd: line.start };
  }

  // 取块
  const { blockOf, blocks } = assignBlocks(lines, prot);
  const block = blocks[blockOf[i]];
  const blockStart = lines[block.rows[0]].start;
  const blockEnd = lines[block.rows[block.rows.length - 1]].end;
  const oldBlock = work.slice(blockStart, blockEnd);

  // 单项块护栏（知情偏离，见勘察 §0 裁决 6）：块内只有 1 个列表项时不拉直，退化为"当前号+1"。
  // 不加这条，loose list（"1. a\n\n2. b"）里的 "2. b" 会被孤立分块后改写成 "1. b"，
  // 用户毫无感觉但文件已经坏了。
  const straighten = block.items >= 2;
  const bumpedNum = String(Number(item.numText) + 1);

  // 造出"块的新样子"：当前行截断成 before/after 两条 item，其余行原样透传（item 走结构化字段，
  // raw 走透传），交给 renumberBlock 统一重排——不能自己拼字符串再让它去解析（见 listModel.ts
  // RenumberItemRow 的 JSDoc：gap 是贪婪匹配，回车带到新行的余文若以空白开头会被吞进 gap）。
  const rows: RenumberInputRow[] = [];
  let newLineSlot = -1;
  for (const r of block.rows) {
    if (r === i) {
      rows.push({ kind: "item", indent: item.indent, numText: item.numText, gap: item.gap, content: contentBefore });
      newLineSlot = rows.length;
      // 新行继承当前行的缩进与 gap；numText 填 bumpedNum，straighten=true 时会被 renumberBlock 整体覆盖，
      // straighten=false 时它就是最终值，两种情况下都不用另填占位串。
      rows.push({
        kind: "item",
        indent: item.indent,
        numText: bumpedNum,
        gap: item.gap,
        content: restOfLine,
      });
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
  const newLineMarkerLen = renumbered[newLineSlot].markerLen ?? 0;

  // 最小替换区间 = 前后缀裁剪，编号本来就对时自然塌成插入点（需求 3 与需求 5 的统一解）。
  const span = trimEditSpan(oldBlock, newBlock, blockStart, caret);

  // 光标：不能用"旧光标+增量"算——宽度漂移可以发生在光标上方（块内前面的项从 9→10 位数变化）。
  // 必须用 blockStart + 新块内新行之前所有行的长度和 + 新行重排后的 markerLen（勘察 §E）。
  let newLineOffset = 0;
  for (let idx = 0; idx < newLineSlot; idx += 1) newLineOffset += out[idx].length + 1;
  const cursor = blockStart + newLineOffset + newLineMarkerLen;

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
