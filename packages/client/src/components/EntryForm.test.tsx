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

describe("EntryForm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T03:00:00+08:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not block save preemptively when endTime is in the future (defers to onSave)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    await act(async () => {
      createRoot(container).render(
        createElement(EntryForm, {
          startTime: "2026-05-20T09:00:00",
          endTime: "2026-05-20T22:00:00",
          onSave,
          onCancel: () => {},
        }),
      );
    });

    expect(container.querySelector('[data-testid="time-error"]')?.textContent).toBe("");

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "保存");
    if (!saveButton) throw new Error("save button not found");
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledWith("cat-work", "2026-05-19T09:00:00", "2026-05-19T22:00:00", "");
  });

  it("shows the shift hint when the resolved range is moved to a previous day", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      createRoot(container).render(
        createElement(EntryForm, {
          startTime: "2026-05-20T09:00:00",
          endTime: "2026-05-20T22:00:00",
          onSave: vi.fn().mockResolvedValue({ ok: true }),
          onCancel: () => {},
        }),
      );
    });

    expect(container.textContent).toContain("已识别为 2026-05-19 09:00 – 22:00");
  });

  it("does not show the shift hint when no shift happens", async () => {
    vi.setSystemTime(new Date("2026-05-20T15:00:00+08:00"));
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      createRoot(container).render(
        createElement(EntryForm, {
          startTime: "2026-05-20T14:00:00",
          endTime: "2026-05-20T15:00:00",
          onSave: vi.fn().mockResolvedValue({ ok: true }),
          onCancel: () => {},
        }),
      );
    });

    expect(container.textContent).not.toContain("已识别为");
  });

  it("renders the error returned from onSave (e.g. shift-conflict)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: "不能记录尚未发生的时间" });

    await act(async () => {
      createRoot(container).render(
        createElement(EntryForm, {
          startTime: "2026-05-20T09:00:00",
          endTime: "2026-05-20T22:00:00",
          onSave,
          onCancel: () => {},
        }),
      );
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "保存");
    if (!saveButton) throw new Error("save button not found");

    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="time-error"]')?.textContent).toBe("不能记录尚未发生的时间");
  });
});
