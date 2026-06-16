import { type ReactNode, useCallback, useState } from "react";
import { ConfirmSheet } from "../components/ui/ConfirmSheet.js";

interface ConfirmRequest {
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
      setPending({ ...request, resolve });
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
