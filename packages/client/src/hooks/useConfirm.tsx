import { type ReactNode, useCallback, useState } from "react";
import { ConfirmSheet } from "../components/ui/ConfirmSheet.js";

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingRequest extends ConfirmRequest {
  resolve: (value: boolean) => void;
}

/**
 * Promise-based confirm hook. Replaces `window.confirm` for screens that need
 * styled prompts (e.g. EntryPage overlap warnings, SettingsDataPage destructive
 * actions).
 *
 * ```tsx
 * const { confirm, dialog } = useConfirm();
 *
 * async function handleDelete() {
 *   if (!(await confirm({ title: "确认删除？", body: "...", danger: true }))) return;
 *   // ...
 * }
 *
 * return (
 *   <>
 *     {dialog}
 *     ...
 *   </>
 * );
 * ```
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingRequest | null>(null);

  const confirm = useCallback((request: ConfirmRequest): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // pending 是单值：第二次调用会直接覆盖第一次，被顶替请求的 resolve 若不主动结算就永远
      // 不 settle。useUnsavedChangesGuard 之类的调用方 await 着它，promise 悬空会让全局
      // useBlocker 卡在 blocked、应用再也导航不了。顶替时解析为「取消」（留在原地），是安全方向。
      // 在 updater 里做这个副作用是安全的：Promise 只会 settle 一次，所以 StrictMode 下
      // React 重复调用 updater 时第二次是 no-op。别为了「纯函数 updater」把它改成 ref 版本——
      // 那会把悬空的口子重新打开。
      setPending((prev) => {
        prev?.resolve(false);
        return { ...request, resolve };
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    pending?.resolve(true);
    setPending(null);
  }, [pending]);

  const handleCancel = useCallback(() => {
    pending?.resolve(false);
    setPending(null);
  }, [pending]);

  const dialog = pending ? (
    <ConfirmSheet
      open
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      danger={pending.danger}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { confirm, dialog };
}
