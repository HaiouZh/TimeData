// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MonthCalendar from "./MonthCalendar.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

function mount(value: string | null, onChange = vi.fn()): { host: HTMLDivElement; onChange: ReturnType<typeof vi.fn> } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);

  act(() => {
    root.render(createElement(MonthCalendar, { value, onChange }));
  });

  return { host, onChange };
}

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

describe("MonthCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T12:00:00+08:00"));
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("initializes the visible month from the controlled value", () => {
    const { host } = mount("2026-03-15");

    expect(host.textContent).toContain("2026年3月");
    expect(buttonByLabel(host, "2026-03-15").getAttribute("aria-pressed")).toBe("true");
    expect(buttonByLabel(host, "2026-03-01").textContent).toBe("1");
  });

  it("initializes the visible month from today's local date when value is empty", () => {
    const { host } = mount(null);

    expect(host.textContent).toContain("2026年6月");
    expect(buttonByLabel(host, "2026-06-16").textContent).toBe("16");
  });

  it("moves between months with labelled buttons and emits YYYY-MM-DD when a day is clicked", () => {
    const { host, onChange } = mount("2026-03-15");

    act(() => {
      buttonByLabel(host, "下个月").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("2026年4月");

    act(() => {
      buttonByLabel(host, "2026-04-30").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("2026-04-30");

    act(() => {
      buttonByLabel(host, "上个月").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.textContent).toContain("2026年3月");
  });
});
