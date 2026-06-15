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

describe("ChartBuilderSheet", () => {
  it("选 2 个指标时禁用柱状", () => {
    const { host, root } = renderSheet({ open: true, initial: null, onSave: vi.fn(), onClose: vi.fn(), onDelete: vi.fn() });

    click(inputByLabel(host, "睡眠时长"));
    click(inputByLabel(host, "HRV"));

    expect(inputByLabel(host, "柱状").disabled).toBe(true);
    act(() => root.unmount());
  });

  it("保存回传含所选指标的配置", () => {
    const onSave = vi.fn();
    const { host, root } = renderSheet({ open: true, initial: null, onSave, onClose: vi.fn(), onDelete: vi.fn() });

    click(inputByLabel(host, "HRV"));
    click(buttonByText(host, "保存"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ metricIds: ["hrv.value"], type: "metricChart" }));
    act(() => root.unmount());
  });
});
