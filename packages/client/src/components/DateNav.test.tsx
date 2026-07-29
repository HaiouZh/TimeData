// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom } from "../test/domHarness.js";
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

  it("exposes DateField capped at today and jumps to the picked date", async () => {
    const onDateChange = vi.fn();
    const container = await mount("2026-05-20", onDateChange);
    expect(container.querySelector('input[type="date"]')).toBeNull();

    await click(findButton(container, "选择日期"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("选择日期");

    await click(document.body.querySelector('button[aria-label="2026-05-15"]'));
    expect(onDateChange).toHaveBeenCalledWith("2026-05-15");
  });

  it("DateField caps future days at today", async () => {
    const container = await mount("2026-05-20", vi.fn());

    await click(findButton(container, "选择日期"));
    await click(document.body.querySelector('button[aria-label="下个月"]'));

    expect((document.body.querySelector('button[aria-label="2026-06-03"]') as HTMLButtonElement | null)?.disabled).toBe(false);
    expect((document.body.querySelector('button[aria-label="2026-06-04"]') as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it("非今天时显示回到今天 pill，点击回今天", async () => {
    const onDateChange = vi.fn();
    const container = await mount("2026-01-15", onDateChange);
    const backToToday = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("回到今天"),
    );
    if (!backToToday) throw new Error("back to today button not found");

    act(() => {
      backToToday.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onDateChange).toHaveBeenCalledWith("2026-06-03");

    const todayContainer = await mount("2026-06-03", onDateChange);
    expect(todayContainer.textContent).not.toContain("回到今天");
  });

  it("日期文字作为 DateField 按钮入口", async () => {
    const container = await mount("2026-01-15", () => {});
    expect(findButton(container, "选择日期").textContent).toContain("1月15日");
  });

  it("传入 onSearch 时渲染搜索按钮并回调", async () => {
    const onSearch = vi.fn();
    const { host } = await renderDom(
      createElement(DateNav, { date: "2026-06-03", onDateChange: () => {}, onSearch }),
    );
    const button = findButton(host, "搜索记录");
    await act(async () => {
      button.click();
    });
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("不传 onSearch 时不渲染搜索按钮", async () => {
    const { host } = await renderDom(createElement(DateNav, { date: "2026-06-03", onDateChange: () => {} }));
    expect(
      Array.from(host.querySelectorAll("button")).some((b) => b.getAttribute("aria-label") === "搜索记录"),
    ).toBe(false);
  });
});
