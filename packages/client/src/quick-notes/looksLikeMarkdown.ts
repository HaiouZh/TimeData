/**
 * 判断速记是否看起来像 Markdown。只识别明确结构语法，避免误改历史纯文本观感。
 */
const STRUCTURAL_PATTERNS: RegExp[] = [
  /^```/m,
  /^#{1,6}\s/m,
  /^\s*[-*+]\s+/m,
  /^\s*\d+\.\s+/m,
  /^\s*[-*]\s+\[[ xX]\]\s/m,
  /^\s*>\s+/m,
  /\|.*\|[\s\S]*?^\s*\|?[\s:-]*-[\s:-]*\|/m,
  /\[[^\]]+\]\([^)\s]+\)/,
  /`[^`\n]+`/,
  /\*\*[^*\n]+\*\*/,
  /~~[^~\n]+~~/,
];

export function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  return STRUCTURAL_PATTERNS.some((pattern) => pattern.test(text));
}
