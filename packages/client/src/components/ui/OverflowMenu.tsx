import { DotsThree } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon.js";

export interface OverflowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** 危险项（删除/砍掉），文字染 danger。 */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * 溢出动作菜单：把低频与危险动作从页面上收起来，只留一个 `⋯`。
 *
 * 外部点击关闭用 `rootRef.contains` 判断而不是在触发器上 `stopPropagation`——
 * 触发器本身在 root 内，展开那一下的 click 冒泡到 document 时 contains 为真，不会自关。
 */
export function OverflowMenu({
  items,
  ariaLabel = "操作菜单",
  testId,
}: {
  items: readonly OverflowMenuItem[];
  ariaLabel?: string;
  testId?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    function onDocumentClick(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onDocumentClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onDocumentClick);
    };
  }, [open]);

  return (
    <div ref={rootRef} data-testid={testId} className="relative shrink-0">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-ctl text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <Icon icon={DotsThree} size={18} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 flex min-w-40 flex-col gap-1 rounded-ctl border border-border bg-surface-elevated p-2 shadow-elev2"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
              className={`rounded-ctl px-4 py-2 text-left td-text-label hover:bg-surface-hover disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                item.danger ? "text-danger" : "text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
