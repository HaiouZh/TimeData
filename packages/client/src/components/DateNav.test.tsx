// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom } from "../test/domHarness.js";
import DateNav from "./DateNav.js";

async function mount(date: string, onDateChange: (next: string) => void): Promise<HTMLElement> {
  const { host } = await renderDom(createElement(DateNav, { date, onDateChange }));
  return host;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === label);
  if (!button) throw new Error(`button with aria-label "${label}" not found`);
  return button as HTMLButtonElement;
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
}

describe("DateNav", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00+08:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a humanized date label with the today marker", async () => {
    const container = await mount("2026-06-03", () => {});
    expect(container.textContent).toContain("6月3日");
    expect(container.textContent).toContain("今天");
  });

  it("still jumps one day back via the arrow", async () => {
    const onDateChange = vi.fn();
    const container = await mount("2026-06-03", onDateChange);
    act(() => {
      findButton(container, "前一天").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDateChange).toHaveBeenCalledWith("2026-06-02");
  });

  it("exposes a date picker capped at today and jumps to the picked date", async () => {
    const onDateChange = vi.fn();
    const container = await mount("2026-05-20", onDateChange);
    const input = container.querySelector('input[type="date"]') as HTMLInputElement | null;
    if (!input) throw new Error("date input not found");
    expect(input.getAttribute("max")).toBe("2026-06-03");

    act(() => {
      setNativeValue(input, "2026-01-15");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onDateChange).toHaveBeenCalledWith("2026-01-15");
  });
});
