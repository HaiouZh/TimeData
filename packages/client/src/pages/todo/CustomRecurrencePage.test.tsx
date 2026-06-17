// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { CustomRecurrenceInput } from "../../lib/tasks/recurrencePresets.js";
import { CustomRecurrencePage } from "./CustomRecurrencePage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initial: CustomRecurrenceInput = {
  interval: 2,
  unit: "daily",
  start: "2026-06-16",
  endMode: "never",
  basis: "due",
};

async function render(props: Parameters<typeof CustomRecurrencePage>[0]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(CustomRecurrencePage, props)));
  return { host, root };
}

const click = (el: Element | null) => act(async () => el?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const byLabel = (host: HTMLElement, label: string) => host.querySelector(`[aria-label="${label}"]`);
const clickOption = (host: HTMLElement, text: string) =>
  click([...host.querySelectorAll('[role="option"]')].find((el) => el.textContent === text) ?? null);

describe("CustomRecurrencePage", () => {
  it("完成回传 recurrence + startAt", async () => {
    const onComplete = vi.fn();
    const { host, root } = await render({ initial, onComplete, onBack: vi.fn() });

    await click(byLabel(host, "完成"));

    expect(onComplete).toHaveBeenCalledWith({ freq: "daily", interval: 2, basis: "due" }, "2026-06-16");
    await act(async () => root.unmount());
  });

  it("单位是可滚动转盘（天/周/月）", async () => {
    const { host, root } = await render({ initial, onComplete: vi.fn(), onBack: vi.fn() });

    const wheel = byLabel(host, "重复单位");
    expect(wheel?.getAttribute("role")).toBe("listbox");
    const labels = [...host.querySelectorAll('[aria-label="重复单位"] [role="option"]')].map((el) => el.textContent);
    expect(labels).toContain("天");
    expect(labels).toContain("周");
    expect(labels).toContain("月");
    await act(async () => root.unmount());
  });

  it("切到周单位后按起始日推 byWeekday", async () => {
    const onComplete = vi.fn();
    const { host, root } = await render({ initial, onComplete, onBack: vi.fn() });

    await clickOption(host, "周");
    await click(byLabel(host, "完成"));

    expect(onComplete.mock.calls.at(-1)?.[0]).toMatchObject({ freq: "weekly", byWeekday: [2] });
    await act(async () => root.unmount());
  });

  it("月末开关写 byMonthday [-1]", async () => {
    const onComplete = vi.fn();
    const { host, root } = await render({
      initial: { ...initial, unit: "monthly" },
      onComplete,
      onBack: vi.fn(),
    });

    await click(byLabel(host, "每月最后一天"));
    await click(byLabel(host, "完成"));

    expect(onComplete.mock.calls.at(-1)?.[0]).toMatchObject({ freq: "monthly", byMonthday: [-1] });
    await act(async () => root.unmount());
  });

  it("复杂旧规则未改时保留命中日", async () => {
    const onComplete = vi.fn();
    const { host, root } = await render({
      initial: {
        ...initial,
        unit: "weekly",
        interval: 1,
        preserveHitDays: true,
        preservedByWeekday: [1, 3, 5],
      },
      onComplete,
      onBack: vi.fn(),
    });

    await click(byLabel(host, "完成"));

    expect(onComplete.mock.calls.at(-1)?.[0]).toMatchObject({ freq: "weekly", byWeekday: [1, 3, 5] });
    await act(async () => root.unmount());
  });

  it("父级用等价 initial 重新渲染时不重置本地草稿", async () => {
    const onComplete = vi.fn();
    const onBack = vi.fn();
    const { host, root } = await render({ initial, onComplete, onBack });

    await clickOption(host, "周");
    await act(async () => {
      root.render(createElement(CustomRecurrencePage, { initial: { ...initial }, onComplete, onBack }));
    });
    await click(byLabel(host, "完成"));

    expect(onComplete.mock.calls.at(-1)?.[0]).toMatchObject({ freq: "weekly", byWeekday: [2] });
    await act(async () => root.unmount());
  });

  it("点返回不调用 onComplete", async () => {
    const onComplete = vi.fn();
    const onBack = vi.fn();
    const { host, root } = await render({ initial, onComplete, onBack });

    await click(byLabel(host, "返回"));

    expect(onBack).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
