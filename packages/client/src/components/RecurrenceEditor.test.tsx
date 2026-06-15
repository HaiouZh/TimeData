// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { RecurrenceEditor } from "./RecurrenceEditor.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderEditor(props: Parameters<typeof RecurrenceEditor>[0]) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(RecurrenceEditor, props));
  });
  return { host, root };
}

async function rerenderEditor(root: ReturnType<typeof createRoot>, props: Parameters<typeof RecurrenceEditor>[0]) {
  await act(async () => {
    root.render(createElement(RecurrenceEditor, props));
  });
}

function inputByLabel(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  return input;
}

describe("RecurrenceEditor", () => {
  it("emits a daily recurrence when enabled", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderEditor({ value: null, onChange });
    const toggle = host.querySelector('input[type="checkbox"]');

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ freq: "daily", interval: 1, basis: "due" }));
    await act(async () => root.unmount());
  });

  it("shows weekday picker for weekly", async () => {
    const { host, root } = await renderEditor({
      value: { freq: "weekly", interval: 1, byWeekday: [1], basis: "due" },
      onChange: () => {},
    });

    expect(host.textContent).toContain("周一");
    await act(async () => root.unmount());
  });

  it("resets monthday when switching to monthly", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderEditor({ value: { freq: "daily", interval: 2, basis: "completion" }, onChange });
    const select = host.querySelector("select") as HTMLSelectElement | null;

    await act(async () => {
      if (select) {
        select.value = "monthly";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ freq: "monthly", interval: 2, byMonthday: [1], basis: "completion" }),
    );
    await act(async () => root.unmount());
  });

  it("选『按次数』写入 count、清掉 until", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderEditor({ value: { freq: "daily", interval: 1, basis: "due" }, onChange });

    await act(async () => {
      inputByLabel(host, "按次数").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
    expect(onChange.mock.calls.at(-1)?.[0]).not.toHaveProperty("until");
    await act(async () => root.unmount());
  });

  it("选『按日期』写入 until、清掉 count", async () => {
    const onChange = vi.fn();
    const initial = { freq: "daily", interval: 1, basis: "due", count: 5 } as const;
    const { host, root } = await renderEditor({ value: initial, onChange });

    await act(async () => {
      inputByLabel(host, "按日期").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const next = onChange.mock.calls.at(-1)?.[0];
    await rerenderEditor(root, { value: next, onChange });
    const dateInput = inputByLabel(host, "截止日期");
    await act(async () => {
      dateInput.value = "2026-07-31";
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toHaveProperty("until");
    expect(last).not.toHaveProperty("count");
    await act(async () => root.unmount());
  });

  it("选『永不』清掉 count 与 until", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderEditor({ value: { freq: "daily", interval: 1, basis: "due", count: 5 }, onChange });

    await act(async () => {
      inputByLabel(host, "永不").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).not.toHaveProperty("count");
    expect(last).not.toHaveProperty("until");
    await act(async () => root.unmount());
  });
});
