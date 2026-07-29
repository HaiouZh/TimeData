// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { buildMinuteOptions, TimeField } from "./TimeField.js";

function buttonByLabel(host: HTMLElement, label: string): HTMLButtonElement | null {
  return host.querySelector(`button[aria-label="${label}"]`);
}

function optionByText(host: HTMLElement, text: string): HTMLElement | undefined {
  return [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === text);
}

describe("TimeField", () => {
  it("按步长生成分钟选项", () => {
    expect(buildMinuteOptions(15)).toEqual(["00", "15", "30", "45"]);
    expect(buildMinuteOptions(20)).toEqual(["00", "20", "40"]);
  });

  it("渲染选中时间并打开选择 Sheet", async () => {
    const { host, root } = await renderDom(
      createElement(TimeField, { value: "09:30", onChange: () => {}, ariaLabel: "选择时间" }),
    );

    const trigger = buttonByLabel(host, "选择时间");
    expect(trigger?.textContent).toContain("09:30");
    await click(trigger);

    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("选择时间");
    await unmount(root);
  });

  it("确认前只更新草稿，确认后提交 HH:mm", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(TimeField, { value: null, minuteStep: 15, onChange, ariaLabel: "选择时间" }),
    );

    await click(buttonByLabel(host, "选择时间"));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("00:00");

    await click(optionByText(host, "08"));
    await click(optionByText(host, "45"));
    expect(onChange).not.toHaveBeenCalled();

    await click(buttonByLabel(host, "确认时间"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("08:45");
    await unmount(root);
  });

  it("空值打开后未改动就确认，不写入 00:00", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(TimeField, { value: null, onChange, ariaLabel: "选择时间" }),
    );

    await click(buttonByLabel(host, "选择时间"));
    await click(buttonByLabel(host, "确认时间"));

    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await unmount(root);
  });

  it("组件分钟转盘消费 minuteStep", async () => {
    const { host, root } = await renderDom(
      createElement(TimeField, { value: null, minuteStep: 15, onChange: () => {}, ariaLabel: "选择时间" }),
    );

    await click(buttonByLabel(host, "选择时间"));

    expect(optionByText(host, "45")).toBeDefined();
    expect(optionByText(host, "44")).toBeUndefined();
    await unmount(root);
  });

  it("clearable 且有值时可清除为 null", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(TimeField, { value: "09:30", onChange, ariaLabel: "选择时间", clearable: true }),
    );

    await click(buttonByLabel(host, "选择时间"));
    await click(buttonByLabel(host, "清除时间"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    await unmount(root);
  });
});
