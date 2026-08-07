import { X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Icon } from "../Icon.js";

export interface ConfirmDeleteButtonProps {
  onConfirm: () => void | Promise<void>;
  /** 值变化即复位待确认态。轨道两处传 `editing`：进编辑态要撤销待确认。 */
  resetKey?: unknown;
  /** aria-label 基名：「删除{target}」/「确认删除{target}」。 */
  target: string;
  className?: string;
}

/** 就地二次确认删除。用于「删掉对象内部的一条」；删掉一个完整对象走 ConfirmSheet（见 design-language）。 */
export function ConfirmDeleteButton({ onConfirm, resetKey, target, className }: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setConfirming(false);
  }, [resetKey]);

  return (
    <button
      type="button"
      aria-label={confirming ? `确认删除${target}` : `删除${target}`}
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        void onConfirm();
      }}
      className={`inline-flex h-7 items-center justify-center rounded-ctl bg-surface-elevated px-2 text-ink-2 hover:text-danger ${
        confirming ? "td-text-caption text-danger" : "w-7"
      }${className ? ` ${className}` : ""}`}
    >
      {confirming ? "确认删除" : <Icon icon={X} size={15} />}
    </button>
  );
}
