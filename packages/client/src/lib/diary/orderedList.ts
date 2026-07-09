// 有序列表续号纯函数
// 假设：输入 value 来自 textarea.value，按 HTML 规范换行已归一为 LF（"\n"）；
// 本函数只服务 textarea，不处理 CRLF。
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
  // 只依据光标前后文本判定：marker 必须完整出现在光标之前才有意义
  const beforeLine = value.slice(lineStart, selStart);
  const m = ITEM_RE.exec(beforeLine);
  if (!m) return null;
  // 选区终点之后、本行内剩余的文本
  const nl = after.indexOf("\n");
  const afterInLine = nl === -1 ? after : after.slice(0, nl);
  // 空列表项（光标前只有 "N. "、行内光标后无余文）回车：清掉序号
  if (m[2] === "" && afterInLine === "") {
    return { value: value.slice(0, lineStart) + after, cursor: lineStart };
  }
  const marker = `${Number(m[1]) + 1}. `;
  const next = `${before}\n${marker}${after}`;
  // 光标统一落在完整 marker（含空格）之后
  return { value: next, cursor: before.length + 1 + marker.length };
}
