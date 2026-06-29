import { type ReactNode, useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { Icon } from "../Icon.js";
import { Z } from "../../lib/zLayers.js";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  z?: number;
}

export function Sheet({ open, onClose, title, ariaLabel, children, className, z }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-overlay fixed inset-0 flex items-end justify-center bg-black/60"
      style={{ zIndex: z ?? Z.modal }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? ariaLabel}
        tabIndex={-1}
        className={`sheet-panel flex w-full max-w-2xl flex-col rounded-t-card border border-border bg-surface-elevated text-ink shadow-elev2 outline-none max-h-[88vh] ${className ?? ""}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto mt-2 h-1 w-8 rounded-pill bg-border-strong" aria-hidden="true" />
        {title && (
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-base text-ink">{title}</h2>
            <button type="button" aria-label="关闭" onClick={onClose} className="text-ink-3">
              <Icon icon={X} size={20} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
