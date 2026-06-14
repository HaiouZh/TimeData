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
});
