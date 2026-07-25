// 行尾保护：textarea.value 按 HTML 规范会把换行归一为 LF（"\n"），若原文件是 CRLF，
// 打开再保存一次就会把整篇行尾静默改成 LF —— 这正是本页要避免的 vault 污染，只不过来自我们自己。
// detectEol 在"进 textarea 之前"的原始 fetch 结果上探测主导行尾，供 DiaryPage 保存时还原。
// 详见 docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/4-键位语义.md §3.1–§3.3。

/**
 * 探测一段文本的主导行尾。
 * 平局（CRLF 与 LF 计数相等）与无换行一律判 LF（新建文件/模板展开走的也是 LF）。
 * 孤立 `\r`（老 Mac 行尾）不计入 CRLF 也不计入 LF 计数；这类文件本来就会被 textarea 的
 * HTML 规范归一行为转成 LF —— 属已知不修，不在本函数职责内处理。
 */
export function detectEol(raw: string): "\r\n" | "\n" {
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/\n/g) ?? []).length - crlf; // 总 LF 减去归属 CRLF 的那部分
  return crlf > lf ? "\r\n" : "\n";
}
