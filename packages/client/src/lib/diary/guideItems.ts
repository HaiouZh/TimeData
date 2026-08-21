/**
 * 存档引导拆行的唯一口径：一行一条，trim 后滤空。server 存 raw 多行文本，
 * 两端（宽屏面板 / 窄屏容器）都从这里拿条目——不许各拆各的。
 * 纯函数，模块图里不得出现 db（同 diaryRefEntries 的干净桶约束）。
 */
export function parseGuideItems(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
