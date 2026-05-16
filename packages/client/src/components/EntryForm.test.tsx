// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EntryForm from "./EntryForm.js";

vi.mock("../hooks/useCategories.js", () => ({
  useCategories: () => ({
    parentCategories: [{ id: "cat-work", name: "工作" }],
    getChildren: () => [],
  }),
}));

vi.mock("./CategoryPicker.js", () => ({
  default: ({ onSelect, selectedId }: { onSelect: (id: string) => void; selectedId: string }) =>
    createElement("button", { type: "button", onClick: () => onSelect("cat-work") }, selectedId || "选择分类"),
}));

vi.mock("./TimeRangeWheelPicker.js", () => ({
  default: ({ error }: { error: string }) => createElement("div", { "data-testid": "time-error" }, error),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("EntryForm future time validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T08:00:00+08:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the future time error before saving", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      createRoot(container).render(
        createElement(EntryForm, {
          startTime: "2026-05-08T08:00:00",
          endTime: "2026-05-08T08:30:00",
          onSave: vi.fn(),
          onCancel: () => {},
        })
      );
    });

    expect(container.querySelector('[data-testid="time-error"]')?.textContent).toBe("不能记录尚未发生的时间");
  });

  it("does not save when the selected end time is in the future", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onSave = vi.fn();

    await act(async () => {
      createRoot(container).render(
        createElement(EntryForm, {
          startTime: "2026-05-08T08:00:00",
          endTime: "2026-05-08T08:30:00",
          onSave,
          onCancel: () => {},
        })
      );
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "保存");
    if (!saveButton) throw new Error("save button not found");

    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(container.textContent).toContain("不能记录尚未发生的时间");
  });
});
