// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ChartBuilderSheet } from "./ChartBuilderSheet.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderSheet(props: React.ComponentProps<typeof ChartBuilderSheet>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(createElement(ChartBuilderSheet, props));
  });
  return { host, root };
}

function click(element: Element | null) {
  if (!element) throw new Error("element not found");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
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

function dispatchKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

describe("ChartBuilderSheet", () => {
  it("选 2 个指标时禁用柱状", () => {
    const { host, root } = renderSheet({ open: true, initial: null, onSave: vi.fn(), onClose: vi.fn(), onDelete: vi.fn() });

    click(checkboxByLabel(host, "睡眠时长"));
    click(checkboxByLabel(host, "HRV"));

    expect(radioByText(host, "柱状").disabled).toBe(true);
    act(() => root.unmount());
  });

  it("保存回传含所选指标的图表配置", () => {
    const onSave = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave, onClose: vi.fn(), onDelete: vi.fn() });

    click(checkboxByLabel(host, "HRV"));
    click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ metricIds: ["hrv.value"], view: "chart", source: "healthMetricDaily" }));
    act(() => root.unmount());
  });

  it("趋势模式标签对齐 H2 语义但保留枚举值", () => {
    const { host, root } = renderSheet({ open: true, initial: null, onSave: vi.fn(), onClose: vi.fn(), onDelete: vi.fn() });

    const group = host.querySelector('[role="radiogroup"][aria-label="趋势模式"]');
    expect(group?.textContent).toContain("自动");
    expect(group?.textContent).toContain("指数化");
    expect(group?.textContent).toContain("真实值");
    expect(group?.textContent).not.toContain("归一化");
    expect(group?.textContent).not.toContain("原始值");
    act(() => root.unmount());
  });

  it("creates a metric table draft with CSV enabled", () => {
    const onSave = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave, onClose: vi.fn(), onDelete: vi.fn() });

    click(radioByText(host, "指标表"));
    click(checkboxByLabel(host, "HRV"));
    click(switchByLabel(host, "导出 CSV"));
    click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "table",
        source: "healthMetricDaily",
        columnIds: expect.arrayContaining(["date", "hrv.value"]),
        presentation: expect.objectContaining({ exportEnabled: true }),
      }),
    );
    act(() => root.unmount());
  });

  it("creates a run table draft", () => {
    const onSave = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave, onClose: vi.fn(), onDelete: vi.fn() });

    click(radioByText(host, "跑步表"));
    click(checkboxByLabel(host, "距离"));
    click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ view: "table", source: "runs", columnIds: expect.arrayContaining(["date", "distanceKm"]) }));
    act(() => root.unmount());
  });

  it("聚合方式仅统计卡视图出现", () => {
    const { host, root } = renderSheet({ open: true, initial: null, onSave: vi.fn(), onClose: vi.fn(), onDelete: vi.fn() });

    expect(host.querySelector('[role="radiogroup"][aria-label="聚合方式"]')).toBeNull();
    click(radioByText(host, "统计卡"));
    expect(host.querySelector('[role="radiogroup"][aria-label="聚合方式"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("统计卡保存写入所选聚合方式", () => {
    const onSave = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave, onClose: vi.fn(), onDelete: vi.fn() });

    click(radioByText(host, "统计卡"));
    click(checkboxByLabel(host, "HRV"));
    click(radioByText(host, "均值"));
    click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ view: "stat", source: "derived", metricIds: ["hrv.value"], aggregation: "avg" }),
    );
    act(() => root.unmount());
  });

  it("统计卡缺省聚合为 latest", () => {
    const onSave = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave, onClose: vi.fn(), onDelete: vi.fn() });

    click(radioByText(host, "统计卡"));
    click(checkboxByLabel(host, "HRV"));
    click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ view: "stat", aggregation: "latest" }));
    act(() => root.unmount());
  });

  it("点击遮罩背景关闭", () => {
    const onClose = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave: vi.fn(), onClose, onDelete: vi.fn() });

    click(elBySelector(host, ".chart-builder-overlay"));

    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("点击手柄关闭", () => {
    const onClose = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave: vi.fn(), onClose, onDelete: vi.fn() });

    click(host.querySelector('button[aria-label="关闭"]'));

    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("按 Esc 关闭", () => {
    const onClose = vi.fn();
    const { root } = renderSheet({ open: true, initial: null, onSave: vi.fn(), onClose, onDelete: vi.fn() });

    dispatchKey("Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
