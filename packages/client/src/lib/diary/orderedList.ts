// 有序列表续号纯函数
const ITEM_RE = /^(\d+)\. (.*)$/;

/**
 * 在有序列表中处理回车键
 * @param value 完整文本
 * @param selStart 选区起点（光标或选区左端）
 * @param selEnd 选区终点（光标或选区右端）
 * @returns 返回 null 表示不处理；否则返回新文本和光标位置
 */
export function applyEnterInOrderedList(
  value: string,
  selStart: number,
  selEnd: number,
): { value: string; cursor: number } | null {
  const before = value.slice(0, selStart);
  const after = value.slice(selEnd);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = value.indexOf("\n", selStart);
  const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const m = ITEM_RE.exec(line);
  if (!m) return null;
  const [, numStr, rest] = m;
  const caretInLine = selStart - lineStart;
  // 空列表项（只有 "N. "）回车：清掉序号
  if (rest === "" && caretInLine >= line.length) {
    const next = value.slice(0, lineStart) + after.replace(/^/, "");
    return { value: next, cursor: lineStart };
  }
  const marker = `${Number(numStr) + 1}. `;
  const next = `${before}\n${marker}${after}`;
  // 光标统一落在完整 marker（含空格）之后
  return { value: next, cursor: before.length + 1 + marker.length };
}
