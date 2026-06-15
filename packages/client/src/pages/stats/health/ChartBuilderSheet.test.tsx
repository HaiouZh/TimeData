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

function inputByLabel(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return input;
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

function dispatchKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

describe("ChartBuilderSheet", () => {
  it("选 2 个指标时禁用柱状", () => {
    const { host, root } = renderSheet({ open: true, initial: null, onSave: vi.fn(), onClose: vi.fn(), onDelete: vi.fn() });

    click(inputByLabel(host, "睡眠时长"));
    click(inputByLabel(host, "HRV"));

    expect(inputByLabel(host, "柱状").disabled).toBe(true);
    act(() => root.unmount());
  });

  it("保存回传含所选指标的图表配置", () => {
    const onSave = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave, onClose: vi.fn(), onDelete: vi.fn() });

    click(inputByLabel(host, "HRV"));
    click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ metricIds: ["hrv.value"], view: "chart", source: "healthMetricDaily" }));
    act(() => root.unmount());
  });

  it("creates a metric table draft with CSV enabled", () => {
    const onSave = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave, onClose: vi.fn(), onDelete: vi.fn() });

    click(buttonByText(host, "指标表"));
    click(inputByLabel(host, "HRV"));
    click(inputByLabel(host, "导出 CSV"));
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

    click(buttonByText(host, "跑步表"));
    click(inputByLabel(host, "距离"));
    click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ view: "table", source: "runs", columnIds: expect.arrayContaining(["date", "distanceKm"]) }));
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
