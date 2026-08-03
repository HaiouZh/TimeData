export interface DesktopUndoState {
  message: string;
}

/**
 * 「不写」与失败的窗口内落点。此前 `noRange` / `missingCategory` / 队列里抛出的失败
 * 唯一的反馈是系统通知，而通知两端各吞一次（Rust 的 `let _ = …show()`、桥的 `quietly`）：
 * 专注助手开着或通知权限关了，这几条出口就是屏幕上零变化。本条是**不经通知通道**的那一份，
 * 直接画在窗口里，通知发不发得出去都在。
 */
export interface DesktopNoticeState {
  message: string;
}

export interface DesktopConfirmState {
  message: string;
  /**
   * 是不是「点过一次『记录』之后又弹出来的」。点了记录卡片仍可能再弹——重试时按当下数据重算
   * 又超过了已批准的长度（同步把锚点记录删掉了）。此时用户看到的是一个变长了的新区间，
   * 副文案必须与首次可区分，否则他只会以为自己点的那下没生效。
   */
  retry: boolean;
}

const HINT_FIRST = "间隔超过了确认阈值，可能是同步还没拉完。";
const HINT_RETRY = "刚才那条记录已不在了，区间比你看到的更长。";

/**
 * 桌面热键打点的全局反馈层：撤销条不自动消失（窗口可能整段隐藏，打开时要还在，
 * spec §五.5.5），确认卡是超阈值防打歪的守门员（spec §五.5.2）。
 */
export function DesktopPunchLayer({
  undo,
  confirm,
  notice,
  onUndo,
  onDismissUndo,
  onDismissNotice,
  onConfirm,
  onCancelConfirm,
}: {
  undo: DesktopUndoState | null;
  confirm: DesktopConfirmState | null;
  notice: DesktopNoticeState | null;
  onUndo: () => void;
  onDismissUndo: () => void;
  onDismissNotice: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
}) {
  if (!undo && !confirm && !notice) return null;
  return (
    <>
      {(undo || notice) && (
        <div className="fixed inset-x-4 top-4 z-[var(--z-backdrop)] mx-auto flex max-w-md flex-col gap-2">
          {notice && (
            <div
              role="status"
              aria-label="桌面打点提示"
              className="flex items-center gap-3 rounded-card border border-border-strong bg-surface/95 px-3 py-2 td-text-body text-ink shadow-elev1"
            >
              <span className="min-w-0 flex-1">{notice.message}</span>
              <button
                type="button"
                onClick={onDismissNotice}
                className="shrink-0 text-ink-3 transition hover:text-ink"
                aria-label="关闭提示"
              >
                ✕
              </button>
            </div>
          )}
          {undo && (
            <div
              role="status"
              aria-label="桌面打点反馈"
              className="flex items-center gap-3 rounded-card border border-border-strong bg-surface/95 px-3 py-2 td-text-body text-ink shadow-elev1"
            >
              <span className="min-w-0 flex-1 truncate">{undo.message}</span>
              <button
                type="button"
                onClick={onUndo}
                className="shrink-0 font-semibold text-accent transition hover:text-accent-ink"
              >
                撤销
              </button>
              <button
                type="button"
                onClick={onDismissUndo}
                className="shrink-0 text-ink-3 transition hover:text-ink"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}
      {confirm && (
        <div
          role="alertdialog"
          aria-label="打点确认"
          className="fixed inset-x-4 top-1/3 z-[var(--z-backdrop)] mx-auto max-w-md rounded-card border border-border-strong bg-surface p-4 shadow-elev1"
        >
          <p className="td-text-body text-ink">{confirm.message}</p>
          <p className="mt-1 td-text-caption text-ink-3">{confirm.retry ? HINT_RETRY : HINT_FIRST}</p>
          <div className="mt-3 flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancelConfirm}
              className="rounded-ctl px-3 py-1.5 td-text-label font-medium text-ink-2 transition hover:bg-surface-hover"
            >
              算了
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-ctl bg-accent px-3 py-1.5 td-text-label font-medium text-page transition hover:bg-accent-strong"
            >
              记录
            </button>
          </div>
        </div>
      )}
    </>
  );
}
