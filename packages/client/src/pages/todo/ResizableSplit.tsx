import { type ReactNode, type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import {
  clampSplitRatio,
  loadSplitRatio,
  saveSplitRatio,
  type SplitPrefs,
  TODO_SPLIT_PREFS,
} from "../../lib/tasks/workbenchPrefs.js";

export interface ResizableSplitProps {
  left: ReactNode;
  right: ReactNode;
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
  separatorLabel?: string;
  prefs?: SplitPrefs;
}

function formatRatio(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function ResizableSplit({
  left,
  right,
  className,
  leftClassName,
  rightClassName,
  separatorLabel = "调整左右面板宽度",
  prefs = TODO_SPLIT_PREFS,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activePointerId = useRef<number | null>(null);
  const [ratio, setRatio] = useState(() => loadSplitRatio(prefs));
  const ratioRef = useRef(ratio);

  function applyRatio(nextRatio: number): number {
    const next = clampSplitRatio(nextRatio, prefs);
    ratioRef.current = next;
    setRatio(next);
    return next;
  }

  function applyAndSaveRatio(nextRatio: number): void {
    saveSplitRatio(applyRatio(nextRatio), prefs);
  }

  function updateFromPointer(event: ReactPointerEvent): void {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    applyRatio((event.clientX - rect.left) / rect.width);
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (activePointerId.current !== event.pointerId) return;
    activePointerId.current = null;
    saveSplitRatio(ratioRef.current, prefs);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const leftRatio = formatRatio(ratio);
  const rightRatio = formatRatio(1 - ratio);

  return (
    <div
      ref={containerRef}
      className={`grid min-h-0 gap-0 ${className ?? ""}`}
      style={{ gridTemplateColumns: `minmax(0, ${leftRatio}fr) 16px minmax(0, ${rightRatio}fr)` }}
    >
      <section className={`min-w-0 space-y-4 ${leftClassName ?? ""}`}>{left}</section>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={separatorLabel}
        aria-valuemin={Math.round(prefs.min * 100)}
        aria-valuemax={Math.round(prefs.max * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        className="group flex cursor-col-resize touch-none items-stretch justify-center self-stretch px-1"
        onPointerDown={(event) => {
          event.preventDefault();
          activePointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (activePointerId.current === event.pointerId) updateFromPointer(event);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={() => {
          applyAndSaveRatio(prefs.defaultRatio);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.05;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            applyAndSaveRatio(ratioRef.current - step);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            applyAndSaveRatio(ratioRef.current + step);
          } else if (event.key === "Home") {
            event.preventDefault();
            applyAndSaveRatio(0);
          } else if (event.key === "End") {
            event.preventDefault();
            applyAndSaveRatio(1);
          } else if (event.key === "Enter" || event.key === "0") {
            event.preventDefault();
            applyAndSaveRatio(prefs.defaultRatio);
          }
        }}
      >
        <div className="my-1 w-px rounded-pill bg-border transition-colors group-hover:bg-accent" />
      </div>
      <section className={`min-w-0 space-y-4 ${rightClassName ?? ""}`}>{right}</section>
    </div>
  );
}
