import { useCallback, useEffect, useRef } from "react";
import { type BlockerFunction, useBlocker } from "react-router";
import type { ConfirmRequest } from "./useConfirm.js";

interface UnsavedChangesGuardOptions {
  /** 为 true 时拦截离开本页的导航 */
  when: boolean;
  /**
   * 由调用方传入（复用页面自己的 useConfirm 实例，避免并存两个 ConfirmSheet）。
   * 不要求引用稳定：effect 只依赖 `blocker.state` 字符串，传内联箭头函数 / 每次新对象也安全。
   */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  title?: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * 有未保存修改时拦住所有离开路径。两条腿互补，缺一不可：
 * - `useBlocker`：站内换页（侧栏 / 底栏 / <Link> / navigate() / 浏览器后退 / 安卓返回键）。
 *   要求 data router，否则抛 "useBlocker must be used within a data router."
 * - `beforeunload`：关标签页 / 刷新 / 跳外链。useBlocker 一概管不到这些。
 *
 * 注意（实测行为，改动前先读）：
 * - `proceed()` 重复调用会抛 "Invalid blocker state transition: unblocked -> proceeding"；
 *   `reset()` 反而是幂等的。
 * - `when` 由 true 翻回 false **不会**自动解除已经 blocked 的状态。
 * - 组件卸载**不需要**手动 reset：useBlocker 内部 cleanup 已 deleteBlocker。
 * - 将来若出现「保存成功后在同一个 handler 里主动跳转」的流程，会被误拦
 *   （shouldBlock 读到的是上一帧的 when），届时需要加一个一次性 bypass ref。
 * - 传入的 `confirm` 若来自 `useConfirm`：确认弹层被新请求顶替时会把旧请求 resolve(false)
 *   （留在原地，安全方向），不会悬空——否则这里 `await confirmRef.current(...)` 永远不 settle，
 *   blocker 卡死在 blocked，全局再也导航不了。
 * - 询问的 effect 只依赖 `blocker.state` 字符串：blocked 期间再来一次导航只换 blocker 对象、
 *   不改 state，effect 不重跑，因此不会重复弹窗；proceed/reset 一律对 `blockerRef.current`
 *   这个最新对象调用，否则会放行到上一次那个目标。
 */
export function useUnsavedChangesGuard({
  when,
  confirm,
  title = "放弃未保存的修改？",
  body = "离开后当前修改将丢失。",
  confirmLabel = "放弃修改",
  cancelLabel = "继续编辑",
}: UnsavedChangesGuardOptions): void {
  // 用 ref 读 when，让 shouldBlock 保持恒等引用：否则 when 每变一次就重注册一次 blocker
  const whenRef = useRef(when);
  whenRef.current = when;

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => whenRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );

  const blocker = useBlocker(shouldBlock);

  // 用 ref 读，让 effect 不因这些引用变化而重跑
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const copyRef = useRef({ title, body, confirmLabel, cancelLabel });
  copyRef.current = { title, body, confirmLabel, cancelLabel };

  const blockerState = blocker.state;

  useEffect(() => {
    if (blockerState !== "blocked") return;
    void (async () => {
      const ok = await confirmRef.current({ ...copyRef.current, danger: true });
      // 用 ref 取最新 blocker：blocked 期间再来一次导航会换一个新 blocker 对象（目标不同），
      // 拿闭包里的旧对象 proceed() 会跳到上一次那个目标。
      const current = blockerRef.current;
      if (current.state !== "blocked") return;
      if (ok) current.proceed();
      else current.reset();
    })();
    // 刻意不写 cleanup：若在 cleanup 里置 cancelled 标志，effect 因依赖变化重跑时
    // 会把上一次询问的结果吞掉，blocker 就永远卡在 blocked（应用再也导航不了）。
    // 组件卸载后这个 promise 不会 resolve（dialog 一并卸载、没人点按钮），故无需取消。
  }, [blockerState]);

  useEffect(() => {
    if (!when) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [when]);
}
