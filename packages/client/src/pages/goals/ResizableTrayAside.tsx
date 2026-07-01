import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";
import {
  TRAY_WIDTH_DEFAULT,
  TRAY_WIDTH_MAX,
  TRAY_WIDTH_MIN,
  clampTrayWidth,
  loadTrayWidth,
  saveTrayWidth,
} from "./goalTrayPrefs.js";

export interface ResizableTrayAsideProps {
  children: ReactNode;
}

export function ResizableTrayAside({ children }: ResizableTrayAsideProps) {
  const [width, setWidth] = useState(() => loadTrayWidth());
  const widthRef = useRef(width);
  const activePointerId = useRef<number | null>(null);

  function apply(next: number): number {
    const clamped = clampTrayWidth(next);
    widthRef.current = clamped;
    setWidth(clamped);
    return clamped;
  }

  function applyAndSave(next: number): void {
    saveTrayWidth(apply(next));
  }

  // 靠右停靠：面板右缘贴视口右缘，故宽度 = 视口宽 - 指针横坐标。
  function widthFromPointer(clientX: number): number {
    return window.innerWidth - clientX;
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (activePointerId.current !== event.pointerId) return;
    activePointerId.current = null;
    saveTrayWidth(widthRef.current);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <aside
      aria-label="未归类托盘"
      data-drawer="tray"
      className="absolute right-0 top-0 z-20 flex h-full border-l border-border bg-surface-elevated shadow-elev2"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整未归类面板宽度"
        aria-valuemin={TRAY_WIDTH_MIN}
        aria-valuemax={TRAY_WIDTH_MAX}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        className="group flex w-2 shrink-0 cursor-col-resize touch-none items-stretch justify-center"
        onPointerDown={(event) => {
          event.preventDefault();
          activePointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          apply(widthFromPointer(event.clientX));
        }}
        onPointerMove={(event) => {
          if (activePointerId.current === event.pointerId) apply(widthFromPointer(event.clientX));
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={() => applyAndSave(TRAY_WIDTH_DEFAULT)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 24;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            applyAndSave(widthRef.current + step);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            applyAndSave(widthRef.current - step);
          } else if (event.key === "Home") {
            event.preventDefault();
            applyAndSave(TRAY_WIDTH_MAX);
          } else if (event.key === "End") {
            event.preventDefault();
            applyAndSave(TRAY_WIDTH_MIN);
          } else if (event.key === "Enter" || event.key === "0") {
            event.preventDefault();
            applyAndSave(TRAY_WIDTH_DEFAULT);
          }
        }}
      >
        <div className="my-1 w-px rounded-pill bg-border transition-colors group-hover:bg-accent" />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
    </aside>
  );
}
