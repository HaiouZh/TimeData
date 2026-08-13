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
  const [busy, setBusy] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey 是触发器而非读取项——effect 体里不读它，它变了就把二次确认态收回去。删掉这个依赖，重置就只在挂载时发生一次。
  useEffect(() => {
    setConfirming(false);
  }, [resetKey]);

  return (
    <>
      <button
        type="button"
        aria-label={confirming ? `确认删除${target}` : `删除${target}`}
        disabled={busy}
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          if (busy) return;
          setBusy(true);
          void Promise.resolve(onConfirm())
            // 失败由调用方自己展示；这里只负责解锁按钮、退回常态，用户重新点两次即可重试。
            .catch(() => undefined)
            .finally(() => {
              setBusy(false);
              setConfirming(false);
            });
        }}
        className={`inline-flex h-7 items-center justify-center rounded-ctl bg-surface-elevated px-2 text-ink-2 hover:text-danger ${
          confirming ? "td-text-caption text-danger" : "w-7"
        }${className ? ` ${className}` : ""}`}
      >
        {confirming ? "确认删除" : <Icon icon={X} size={15} />}
      </button>
      {/* 只改 aria-label 不会被读屏播报，焦点也没移动；这里补一个视觉隐藏 live region，
          进入待确认态时提示「再按一次」，读屏用户按第一下才能听到反馈。 */}
      <span role="status" aria-live="polite" className="sr-only">
        {confirming ? `再按一次确认删除${target}` : ""}
      </span>
    </>
  );
}
