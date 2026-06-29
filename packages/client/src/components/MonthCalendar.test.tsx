// @vitest-environment jsdom

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../test/domHarness.js";
import MonthCalendar from "./MonthCalendar.js";

async function mount(
  value: string | null,
  onChange = vi.fn(),
): Promise<{ host: HTMLElement; onChange: ReturnType<typeof vi.fn>; unmount: () => Promise<void> }> {
  const { host, root } = await renderDom(createElement(MonthCalendar, { value, onChange }));
  return { host, onChange, unmount: () => unmount(root) };
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
    vi.useRealTimers();
  });

  it("initializes the visible month from the controlled value", async () => {
    const { host, unmount } = await mount("2026-03-15");

    expect(host.textContent).toContain("2026年3月");
    expect(buttonByLabel(host, "2026-03-15").getAttribute("aria-pressed")).toBe("true");
    expect(buttonByLabel(host, "2026-03-01").textContent).toBe("1");

    await unmount();
  });

  it("initializes the visible month from today's local date when value is empty", async () => {
    const { host, unmount } = await mount(null);

    expect(host.textContent).toContain("2026年6月");
    expect(buttonByLabel(host, "2026-06-16").textContent).toBe("16");

    await unmount();
  });

  it("moves between months with labelled buttons and emits YYYY-MM-DD when a day is clicked", async () => {
    const { host, onChange, unmount } = await mount("2026-03-15");

    await click(buttonByLabel(host, "下个月"));
    expect(host.textContent).toContain("2026年4月");

    await click(buttonByLabel(host, "2026-04-30"));
    expect(onChange).toHaveBeenCalledWith("2026-04-30");

    await click(buttonByLabel(host, "上个月"));
    expect(host.textContent).toContain("2026年3月");

    await unmount();
  });
});
