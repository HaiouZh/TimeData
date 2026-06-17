import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computePopoverPosition, type PopoverPosition } from "./popoverPosition.js";

export interface AnchoredPopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  onClose?: () => void;
  ariaLabel?: string;
  className?: string;
  z?: number;
}

export function AnchoredPopover({
  open,
  anchorRef,
  children,
  onClose,
  ariaLabel,
  className,
  z = 60,
}: AnchoredPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel || typeof window === "undefined") return;

    const panelRect = panel.getBoundingClientRect();
    setPosition(
      computePopoverPosition(
        anchor.getBoundingClientRect(),
        { width: panelRect.width, height: panelRect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchorRef]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") return;
    const panel = panelRef.current;
    if (!panel) return;

    const observer = new ResizeObserver(() => updatePosition());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    const focusTarget =
      panel?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ??
      panel;
    focusTarget?.focus({ preventScroll: true });

    return () => {
      restoreFocusRef.current?.focus({ preventScroll: true });
      restoreFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !onClose) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open) return null;

  const popover = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      className={`rounded-row border border-border bg-surface-elevated text-ink shadow-elev2 ${className ?? ""}`}
      style={{
        position: "fixed",
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
        zIndex: z,
      }}
    >
      {children}
    </div>
  );

  return typeof document === "undefined" ? popover : createPortal(popover, document.body);
}
