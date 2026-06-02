// @vitest-environment jsdom
import { localDateTimeToUtc } from "@timedata/shared";
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

const adjacentMock = vi.hoisted(() => ({
  value: {
    prevEntry: null as null | { id: string; startTime: string; endTime: string },
    nextEntry: null as null | { id: string; startTime: string; endTime: string },
  },
}));

vi.mock("../hooks/useEntries.js", () => ({
  useAdjacentEntriesForRange: () => adjacentMock.value,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("EntryForm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T03:00:00+08:00"));
    adjacentMock.value = { prevEntry: null, nextEntry: null };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards the raw same-day range to onSave without any shifting", async () => {
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

    // 不再 shift：传入什么，原样回 onSave。
    expect(onSave).toHaveBeenCalledWith("cat-work", "2026-05-20T09:00:00", "2026-05-20T22:00:00", "");
  });

  it("renders the error returned from onSave (e.g. future endTime)", async () => {
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

  it("disables the save button and shows progress while onSave is pending", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let resolveSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    await act(async () => {
      createRoot(container).render(
        createElement(EntryForm, {
          startTime: "2026-05-20T09:00:00",
          endTime: "2026-05-20T10:00:00",
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

    expect(saveButton.disabled).toBe(true);
    expect(saveButton.textContent).toBe("保存中…");

    await act(async () => {
      resolveSave();
    });

    expect(saveButton.disabled).toBe(false);
    expect(saveButton.textContent).toBe("保存");
  });

  it("merge up extends the start time to the previous entry without writing immediately", async () => {
    adjacentMock.value = {
      prevEntry: {
        id: "prev",
        startTime: localDateTimeToUtc("2026-05-20T09:00:00"),
        endTime: localDateTimeToUtc("2026-05-20T10:00:00"),
      },
      nextEntry: null,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    await act(async () => {
      createRoot(container).render(
        createElement(EntryForm, {
          startTime: "2026-05-20T10:00:00",
          endTime: "2026-05-20T11:00:00",
          onSave,
          onCancel: vi.fn(),
        }),
      );
    });

    const mergeUp = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("向上合并"),
    );
    expect(mergeUp).toBeTruthy();

    await act(async () => {
      mergeUp!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const categoryButton = Array.from(container.querySelectorAll("button")).find((button) =>
      ["选择分类", "cat-work"].includes(button.textContent ?? ""),
    );
    expect(categoryButton).toBeTruthy();
    await act(async () => {
      categoryButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "保存");
    expect(saveButton).toBeTruthy();
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1]).toBe("2026-05-20T09:00:00");
    expect(onSave.mock.calls[0][2]).toBe("2026-05-20T11:00:00");
  });

  it("hides both merge buttons when there is no adjacent entry", async () => {
    adjacentMock.value = { prevEntry: null, nextEntry: null };
    const container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      createRoot(container).render(
        createElement(EntryForm, {
          startTime: "2026-05-20T10:00:00",
          endTime: "2026-05-20T11:00:00",
          onSave: vi.fn().mockResolvedValue({ ok: true }),
          onCancel: vi.fn(),
        }),
      );
    });

    const mergeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("合并"),
    );
    expect(mergeButton).toBeFalsy();
  });
});
