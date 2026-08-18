/**
 * 推到首帧之后再跑。
 *
 * `requestIdleCallback` 在 iOS 17.4+ 可用；缺失时退回一次宏任务让位——那也足以让出首帧，
 * 因为 React 的提交发生在当前任务内。`timeout` 保证再忙也不会被无限推迟。
 */
export function runWhenIdle(fn: () => void, timeoutMs = 2000): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => fn(), { timeout: timeoutMs });
    return;
  }
  setTimeout(fn, 0);
}
