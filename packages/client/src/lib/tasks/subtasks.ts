/** 子任务完成比例：total <= 0 返回 null（不渲染进度条），否则 done / total 夹取到 0..1。 */
export function subtaskProgress(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, done / total));
}
