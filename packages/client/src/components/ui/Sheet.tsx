import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
  portal?: boolean;
}

export function Sheet({ open, onClose, title, ariaLabel, children, className, z, portal = false }: SheetProps) {
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

  const node = (
    <div
      className="sheet-overlay fixed inset-0 flex items-end justify-center bg-backdrop/60"
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
        className={`sheet-panel flex w-full max-w-2xl flex-col rounded-t-card border border-border bg-surface-elevated text-ink shadow-elev2 outline-none ${className ?? ""}`}
        style={{ paddingBottom: "var(--safe-bottom-sheet)" }}
      >
        <div className="mx-auto mt-2 h-1 w-8 rounded-pill bg-border-strong" aria-hidden="true" />
        {title && (
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="td-text-title text-ink">{title}</h2>
            <button type="button" aria-label="关闭" onClick={onClose} className="text-ink-3">
              <Icon icon={X} size={20} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );

  if (!portal || typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
