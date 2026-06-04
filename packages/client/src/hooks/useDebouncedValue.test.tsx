// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./useDebouncedValue.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderHook(initialValue: string, delayMs = 200): {
  getRenderedValue: () => string;
  root: Root;
  setValue: (value: string) => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let currentValue = initialValue;
  let renderedValue = "";

  function TestComponent({ value }: { value: string }) {
    renderedValue = useDebouncedValue(value, delayMs);
    return createElement("span", null, renderedValue);
  }

  function render(value: string) {
    act(() => {
      root.render(createElement(TestComponent, { value }));
    });
  }

  render(currentValue);

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
  document.body.innerHTML = "";
});

describe("useDebouncedValue", () => {
  it("keeps the previous value until the delay expires", () => {
    vi.useFakeTimers();
    const hook = renderHook("old");

    hook.setValue("new");
    expect(hook.getRenderedValue()).toBe("old");

    act(() => vi.advanceTimersByTime(199));
    expect(hook.getRenderedValue()).toBe("old");

    act(() => vi.advanceTimersByTime(1));
    expect(hook.getRenderedValue()).toBe("new");

    act(() => hook.root.unmount());
  });

  it("uses the last value when changes happen quickly", () => {
    vi.useFakeTimers();
    const hook = renderHook("a");

    hook.setValue("b");
    act(() => vi.advanceTimersByTime(100));
    hook.setValue("c");
    act(() => vi.advanceTimersByTime(200));

    expect(hook.getRenderedValue()).toBe("c");

    act(() => hook.root.unmount());
  });
});
