// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "../test/domHarness.js";
import { renderDom, unmount } from "../test/domHarness.js";
import { useDebouncedValue } from "./useDebouncedValue.js";

async function renderHook(
  initialValue: string,
  delayMs = 200,
): Promise<{
  getRenderedValue: () => string;
  root: Root;
  setValue: (value: string) => void;
}> {
  let currentValue = initialValue;
  let renderedValue = "";

  function TestComponent({ value }: { value: string }) {
    renderedValue = useDebouncedValue(value, delayMs);
    return createElement("span", null, renderedValue);
  }

  const { root } = await renderDom(createElement(TestComponent, { value: currentValue }));

  function render(value: string) {
    act(() => {
      root.render(createElement(TestComponent, { value }));
    });
  }

  return {
    getRenderedValue: () => renderedValue,
    root,
    setValue: (value: string) => {
      currentValue = value;
      render(currentValue);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("keeps the previous value until the delay expires", async () => {
    vi.useFakeTimers();
    const hook = await renderHook("old");

    hook.setValue("new");
    expect(hook.getRenderedValue()).toBe("old");

    act(() => vi.advanceTimersByTime(199));
    expect(hook.getRenderedValue()).toBe("old");

    act(() => vi.advanceTimersByTime(1));
    expect(hook.getRenderedValue()).toBe("new");

    await unmount(hook.root);
  });

  it("uses the last value when changes happen quickly", async () => {
    vi.useFakeTimers();
    const hook = await renderHook("a");

    hook.setValue("b");
    act(() => vi.advanceTimersByTime(100));
    hook.setValue("c");
    act(() => vi.advanceTimersByTime(200));

    expect(hook.getRenderedValue()).toBe("c");

    await unmount(hook.root);
  });
});
