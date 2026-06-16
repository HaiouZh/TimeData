import type { ReactNode } from "react";
import { Sheet } from "./Sheet.js";

export interface ConfirmSheetProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      <div className="space-y-4 px-4 pb-4">
        <div className="whitespace-pre-line text-sm text-ink-2">{body}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-ctl border border-border px-4 text-sm text-ink"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`min-h-11 rounded-ctl px-4 text-sm text-page ${danger ? "bg-danger" : "bg-accent-strong"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
