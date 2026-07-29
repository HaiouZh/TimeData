// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { DateField } from "./DateField.js";

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement | null {
  return host.querySelector(`button[aria-label="${label}"]`);
}

describe("DateField", () => {
  it("显示当前日期并打开选择 Sheet", async () => {
    const { host, root } = await renderDom(
      createElement(DateField, { value: "2026-03-15", onChange: () => {}, ariaLabel: "选择日期" }),
    );

    const trigger = buttonByLabel(host, "选择日期");
    expect(trigger?.textContent).toContain("2026-03-15");

    await click(trigger);

    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("选择日期");
    expect(dialog?.textContent).toContain("2026年3月");
    await unmount(root);
  });

  it("点击日期后提交 YYYY-MM-DD 并关闭 Sheet", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(DateField, { value: "2026-03-15", onChange, ariaLabel: "选择日期" }),
    );

    await click(buttonByLabel(host, "选择日期"));
    await click(buttonByLabel(host, "2026-03-20"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-03-20");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await unmount(root);
  });

  it("重选当前日期只关闭 Sheet，不重复触发 onChange", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(DateField, { value: "2026-03-15", onChange, ariaLabel: "选择日期" }),
    );

    await click(buttonByLabel(host, "选择日期"));
    await click(buttonByLabel(host, "2026-03-15"));

    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await unmount(root);
  });

  it("clearable 且有值时可清除为 null", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(DateField, { value: "2026-03-15", onChange, ariaLabel: "选择日期", clearable: true }),
    );

    await click(buttonByLabel(host, "选择日期"));
    await click(buttonByLabel(host, "清除日期"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    await unmount(root);
  });

  it("将 min/max 传给 MonthCalendar 并禁用范围外日期", async () => {
    const { host, root } = await renderDom(
      createElement(DateField, {
        value: "2026-03-15",
        onChange: () => {},
        ariaLabel: "选择日期",
        min: "2026-03-10",
        max: "2026-03-20",
      }),
    );

    await click(buttonByLabel(host, "选择日期"));

    expect(buttonByLabel(host, "2026-03-09")?.disabled).toBe(true);
    expect(buttonByLabel(host, "2026-03-21")?.disabled).toBe(true);
    expect(buttonByLabel(host, "2026-03-10")?.disabled).toBe(false);
    expect(buttonByLabel(host, "2026-03-20")?.disabled).toBe(false);
    await unmount(root);
  });

  it("打开和关闭时通知外层 open 状态", async () => {
    const onOpenChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(DateField, { value: "2026-03-15", onChange: () => {}, ariaLabel: "选择日期", onOpenChange }),
    );

    await click(buttonByLabel(host, "选择日期"));
    await click(buttonByLabel(host, "2026-03-20"));

    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    await unmount(root);
  });

});
