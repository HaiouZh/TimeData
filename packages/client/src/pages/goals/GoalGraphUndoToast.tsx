import { useEffect, useRef } from "react";

const DEFAULT_DURATION_MS = 5000;

export interface GoalGraphUndoToastProps {
  open: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

export function GoalGraphUndoToast({
  open,
  message,
  actionLabel,
  onAction,
  onDismiss,
  durationMs = DEFAULT_DURATION_MS,
}: GoalGraphUndoToastProps) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return undefined;

    // message 是 toast 的身份键：换一条撤销才重置计时；onDismiss 引用变化不重置。
    void message;
    const timeoutId = window.setTimeout(() => onDismissRef.current(), durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [durationMs, message, open]);

  if (!open) return null;

  const canUndo = Boolean(actionLabel && onAction);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 z-[var(--z-backdrop)] mx-auto flex max-w-md items-center gap-3 rounded-card border border-border bg-ink px-4 py-3 td-text-body text-page shadow-lg bottom-4"
      // bottom-4 是 env() 未定义环境（Firefox 桌面 / 旧 WebView）下 calc 失效时的兜底，与 calc 同值。
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {canUndo ? (
        <button
          type="button"
          data-goal-undo-action
          onClick={onAction}
          className="shrink-0 rounded-ctl bg-page px-3 py-1.5 td-text-label font-medium text-ink hover:bg-surface-elevated"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
