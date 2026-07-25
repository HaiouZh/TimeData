import type { ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import { type BlockerFunction, useBlocker } from "react-router-dom";

interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface UnsavedChangesGuardOptions {
  /** 为 true 时拦截离开本页的导航 */
  when: boolean;
  /** 由调用方传入（复用页面自己的 useConfirm 实例，避免并存两个 ConfirmSheet） */
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
 * - `proceed()` 重复调用会抛 "Invalid blocker state transition: unblocked -> proceeding"，
 *   故用 askingRef 保证同一次 blocked 只处理一次；`reset()` 反而是幂等的。
 * - `when` 由 true 翻回 false **不会**自动解除已经 blocked 的状态。
 * - 组件卸载**不需要**手动 reset：useBlocker 内部 cleanup 已 deleteBlocker。
 * - 将来若出现「保存成功后在同一个 handler 里主动跳转」的流程，会被误拦
 *   （shouldBlock 读到的是上一帧的 when），届时需要加一个一次性 bypass ref。
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

  // 同一次 blocked 只弹一次确认
  const askingRef = useRef(false);

  useEffect(() => {
    if (blocker.state !== "blocked") {
      askingRef.current = false;
      return;
    }
    if (askingRef.current) return;
    askingRef.current = true;

    let cancelled = false;
    void (async () => {
      const ok = await confirm({ title, body, confirmLabel, cancelLabel, danger: true });
      if (cancelled) return;
      if (ok) blocker.proceed?.();
      else blocker.reset?.();
    })();

    return () => {
      cancelled = true;
    };
  }, [blocker, confirm, title, body, confirmLabel, cancelLabel]);

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
