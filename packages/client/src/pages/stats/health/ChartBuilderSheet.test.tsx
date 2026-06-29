// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, pressKey, renderDom, unmount } from "../../../test/domHarness.js";
import { ChartBuilderSheet } from "./ChartBuilderSheet.js";

function renderSheet(props: React.ComponentProps<typeof ChartBuilderSheet>) {
  return renderDom(createElement(ChartBuilderSheet, props));
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`);
  return button;
}

function elBySelector(host: HTMLElement, selector: string): HTMLElement {
  const el = host.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`element not found: ${selector}`);
  return el;
}

function checkboxByLabel(host: HTMLElement, text: string): HTMLInputElement {
  const label = [...host.querySelectorAll("label")].find((item) => item.textContent?.trim() === text);
  const input = label?.querySelector('input[type="checkbox"]');
  if (!(input instanceof HTMLInputElement)) throw new Error(`checkbox not found: ${text}`);
  return input;
}

function radioByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button[role="radio"]')].find((item) => item.textContent === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`radio not found: ${text}`);
  return button;
}

function switchByLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const sw = host.querySelector(`button[role="switch"][aria-label="${label}"]`);
  if (!(sw instanceof HTMLButtonElement)) throw new Error(`switch not found: ${label}`);
  return sw;
}

describe("ChartBuilderSheet", () => {
  it("选 2 个指标时禁用柱状", async () => {
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave: vi.fn(),
      onClose: vi.fn(),
      onDelete: vi.fn(),
    });

    await click(checkboxByLabel(host, "睡眠时长"));
    await click(checkboxByLabel(host, "HRV"));

    expect(radioByText(host, "柱状").disabled).toBe(true);
    await unmount(root);
  });

  it("保存回传含所选指标的图表配置", async () => {
    const onSave = vi.fn();
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave,
      onClose: vi.fn(),
      onDelete: vi.fn(),
    });

    await click(checkboxByLabel(host, "HRV"));
    await click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ metricIds: ["hrv.value"], view: "chart", source: "healthMetricDaily" }),
    );
    await unmount(root);
  });

  it("趋势模式标签对齐 H2 语义但保留枚举值", async () => {
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave: vi.fn(),
      onClose: vi.fn(),
      onDelete: vi.fn(),
    });

    const group = host.querySelector('[role="radiogroup"][aria-label="趋势模式"]');
    expect(group?.textContent).toContain("自动");
    expect(group?.textContent).toContain("指数化");
    expect(group?.textContent).toContain("真实值");
    expect(group?.textContent).not.toContain("归一化");
    expect(group?.textContent).not.toContain("原始值");
    await unmount(root);
  });

  it("creates a metric table draft with CSV enabled", async () => {
    const onSave = vi.fn();
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave,
      onClose: vi.fn(),
      onDelete: vi.fn(),
    });

    await click(radioByText(host, "指标表"));
    await click(checkboxByLabel(host, "HRV"));
    await click(switchByLabel(host, "导出 CSV"));
    await click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "table",
        source: "healthMetricDaily",
        columnIds: expect.arrayContaining(["date", "hrv.value"]),
        presentation: expect.objectContaining({ exportEnabled: true }),
      }),
    );
    await unmount(root);
  });

  it("creates a run table draft", async () => {
    const onSave = vi.fn();
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave,
      onClose: vi.fn(),
      onDelete: vi.fn(),
    });

    await click(radioByText(host, "跑步表"));
    await click(checkboxByLabel(host, "距离"));
    await click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "table",
        source: "runs",
        columnIds: expect.arrayContaining(["date", "distanceKm"]),
      }),
    );
    await unmount(root);
  });

  it("聚合方式仅统计卡视图出现", async () => {
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave: vi.fn(),
      onClose: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(host.querySelector('[role="radiogroup"][aria-label="聚合方式"]')).toBeNull();
    await click(radioByText(host, "统计卡"));
    expect(host.querySelector('[role="radiogroup"][aria-label="聚合方式"]')).not.toBeNull();
    await unmount(root);
  });

  it("统计卡保存写入所选聚合方式", async () => {
    const onSave = vi.fn();
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave,
      onClose: vi.fn(),
      onDelete: vi.fn(),
    });

    await click(radioByText(host, "统计卡"));
    await click(checkboxByLabel(host, "HRV"));
    await click(radioByText(host, "均值"));
    await click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ view: "stat", source: "derived", metricIds: ["hrv.value"], aggregation: "avg" }),
    );
    await unmount(root);
  });

  it("统计卡缺省聚合为 latest", async () => {
    const onSave = vi.fn();
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave,
      onClose: vi.fn(),
      onDelete: vi.fn(),
    });

    await click(radioByText(host, "统计卡"));
    await click(checkboxByLabel(host, "HRV"));
    await click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ view: "stat", aggregation: "latest" }));
    await unmount(root);
  });

  it("点击遮罩背景关闭", async () => {
    const onClose = vi.fn();
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave: vi.fn(),
      onClose,
      onDelete: vi.fn(),
    });

    await click(elBySelector(host, ".chart-builder-overlay"));

    expect(onClose).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("点击手柄关闭", async () => {
    const onClose = vi.fn();
    const { host, root } = await renderSheet({
      open: true,
      initial: null,
      onSave: vi.fn(),
      onClose,
      onDelete: vi.fn(),
    });

    await click(host.querySelector('button[aria-label="关闭"]'));

    expect(onClose).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("按 Esc 关闭", async () => {
    const onClose = vi.fn();
    const { root } = await renderSheet({ open: true, initial: null, onSave: vi.fn(), onClose, onDelete: vi.fn() });

    await pressKey("Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
    await unmount(root);
  });
});
