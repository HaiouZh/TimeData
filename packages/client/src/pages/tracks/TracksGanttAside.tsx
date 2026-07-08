import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";
import {
  clampGanttWidth,
  GANTT_WIDTH_DEFAULT,
  GANTT_WIDTH_MIN,
  ganttWidthMax,
  loadGanttWidth,
  saveGanttWidth,
} from "./trackGanttPrefs.js";

const viewport = (): number => (typeof window === "undefined" ? 1280 : window.innerWidth);

// 复制适配 goals/ResizableTrayAside：右停靠、左缘手柄拖宽、宽度偏好入 localStorage（等第三处需要再抽通用组件）。
export function TracksGanttAside({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(() => loadGanttWidth(viewport()));
  const widthRef = useRef(width);
  const activePointerId = useRef<number | null>(null);

  function apply(next: number): number {
    const clamped = clampGanttWidth(next, viewport());
    widthRef.current = clamped;
    setWidth(clamped);
    return clamped;
  }

  function applyAndSave(next: number): void {
    saveGanttWidth(apply(next), viewport());
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (activePointerId.current !== event.pointerId) return;
    activePointerId.current = null;
    saveGanttWidth(widthRef.current, viewport());
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <aside
      aria-label="并发甘特面板"
      className="sticky top-0 flex h-dvh shrink-0 border-l border-border bg-surface"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整甘特面板宽度"
        aria-valuemin={GANTT_WIDTH_MIN}
        aria-valuemax={ganttWidthMax(viewport())}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        className="group flex w-2 shrink-0 cursor-col-resize touch-none items-stretch justify-center"
        onPointerDown={(event) => {
          event.preventDefault();
          activePointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          apply(viewport() - event.clientX);
        }}
        onPointerMove={(event) => {
          if (activePointerId.current === event.pointerId) apply(viewport() - event.clientX);
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={() => applyAndSave(GANTT_WIDTH_DEFAULT)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 24;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            applyAndSave(widthRef.current + step);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            applyAndSave(widthRef.current - step);
          } else if (event.key === "Enter" || event.key === "0") {
            event.preventDefault();
            applyAndSave(GANTT_WIDTH_DEFAULT);
          }
        }}
      >
        <div className="my-1 w-px rounded-pill bg-border transition-colors group-hover:bg-accent" />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
    </aside>
  );
}
