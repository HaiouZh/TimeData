import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLongPressHandlers } from "./useLongPress.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createLongPressHandlers", () => {
  it("triggers after the press duration with the start coordinates", () => {
    const onTrigger = vi.fn();
    const handlers = createLongPressHandlers(onTrigger, { durationMs: 500 });

    handlers.onPointerDown({ clientX: 3, clientY: 4 });
    vi.advanceTimersByTime(499);
    expect(onTrigger).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTrigger).toHaveBeenCalledWith({ x: 3, y: 4 });
  });

  it("cancels when pointer is released early", () => {
    const onTrigger = vi.fn();
    const handlers = createLongPressHandlers(onTrigger);

    handlers.onPointerDown({ clientX: 0, clientY: 0 });
    handlers.onPointerUp();
    vi.advanceTimersByTime(1000);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("cancels when moved beyond tolerance", () => {
    const onTrigger = vi.fn();
    const handlers = createLongPressHandlers(onTrigger, { moveTolerancePx: 10 });

    handlers.onPointerDown({ clientX: 0, clientY: 0 });
    handlers.onPointerMove({ clientX: 20, clientY: 0 });
    vi.advanceTimersByTime(1000);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("triggers immediately on contextmenu and prevents default", () => {
    const onTrigger = vi.fn();
    const preventDefault = vi.fn();
    const handlers = createLongPressHandlers(onTrigger);

    handlers.onContextMenu({ clientX: 8, clientY: 9, preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(onTrigger).toHaveBeenCalledWith({ x: 8, y: 9 });
  });
});
