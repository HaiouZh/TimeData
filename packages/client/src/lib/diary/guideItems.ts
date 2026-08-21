/**
 * 存档引导拆行的唯一口径：一行一条，trim 后滤空。server 存 raw 多行文本，
 * 两端（宽屏面板 / 窄屏容器）都从这里拿条目——不许各拆各的。
 * 纯函数，模块图里不得出现 db（同 diaryRefEntries 的干净桶约束）。
 */
export function parseGuideItems(raw: string): string[] {
  return (
    raw
      // `\r?` 与下面的逐行 trim 互相咬合：CRLF 输入即使 split 只按 `\n` 拆，行尾 `\r` 也会被
      // trim 吃掉——两处观察等价，测试锁不住其一。合并/改写这两行时必须整体保留 CRLF 口径。
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "")
  );
}
