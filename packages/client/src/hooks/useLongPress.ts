import { useRef } from "react";

export interface LongPressTrigger {
  x: number;
  y: number;
}

export interface UseLongPressOptions {
  durationMs?: number;
  moveTolerancePx?: number;
}

interface PointerLike {
  clientX: number;
  clientY: number;
}

interface ContextMenuLike {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
}

export interface LongPressHandlers {
  onPointerDown: (event: PointerLike) => void;
  onPointerMove: (event: PointerLike) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: ContextMenuLike) => void;
}

export function createLongPressHandlers(
  onTrigger: (trigger: LongPressTrigger) => void,
  options: UseLongPressOptions = {},
): LongPressHandlers {
  const durationMs = options.durationMs ?? 500;
  const moveTolerancePx = options.moveTolerancePx ?? 10;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startPoint: LongPressTrigger | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    startPoint = null;
  };

  return {
    onPointerDown(event) {
      clear();
      startPoint = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        timer = null;
        if (startPoint) onTrigger(startPoint);
      }, durationMs);
    },
    onPointerMove(event) {
      if (!startPoint) return;
      const movedTooFar =
        Math.abs(event.clientX - startPoint.x) > moveTolerancePx ||
        Math.abs(event.clientY - startPoint.y) > moveTolerancePx;
      if (movedTooFar) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onContextMenu(event) {
      event.preventDefault();
      onTrigger({ x: event.clientX, y: event.clientY });
      clear();
    },
  };
}

export function useLongPress(
  onTrigger: (trigger: LongPressTrigger) => void,
  options: UseLongPressOptions = {},
): LongPressHandlers {
  const triggerRef = useRef(onTrigger);
  const optionsRef = useRef(options);
  const handlersRef = useRef<LongPressHandlers | null>(null);

  triggerRef.current = onTrigger;

  if (handlersRef.current === null) {
    handlersRef.current = createLongPressHandlers((trigger) => triggerRef.current(trigger), optionsRef.current);
  }

  return handlersRef.current;
}
