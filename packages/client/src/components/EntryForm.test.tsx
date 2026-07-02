// @vitest-environment jsdom
import { localDateTimeToUtc } from "@timedata/shared";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../test/domHarness.js";
import EntryForm, { splitEndDateTime } from "./EntryForm.js";

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
    prevEntry: null as null | { id: string; categoryId: string; startTime: string; endTime: string },
    nextEntry: null as null | { id: string; categoryId: string; startTime: string; endTime: string },
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
    document.body.innerHTML = "";
  });

  it("forwards the raw same-day range to onSave without any shifting", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T09:00:00",
        endTime: "2026-05-20T22:00:00",
        onSave,
        onCancel: () => {},
      }),
    );

    expect(host.querySelector('[data-testid="time-error"]')?.textContent).toBe("");

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存");
    if (!saveButton) throw new Error("save button not found");
    await click(saveButton);

    // 不再 shift：传入什么，原样回 onSave。
    expect(onSave).toHaveBeenCalledWith("cat-work", "2026-05-20T09:00:00", "2026-05-20T22:00:00", "");
    await unmount(root);
  });

  it("splitEndDateTime 把 T00:00 映射为前一天 24:00，其余原样切分", () => {
    expect(splitEndDateTime("2026-05-16T00:00:00")).toEqual({
      date: "2026-05-15",
      hour: "24",
      minute: "00",
    });
    expect(splitEndDateTime("2026-05-15T23:59:00")).toEqual({
      date: "2026-05-15",
      hour: "23",
      minute: "59",
    });
  });

  it("endTime=次日 00:00 时按 24:00 语义原样透传回 onSave", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-15T22:00:00",
        endTime: "2026-05-16T00:00:00",
        onSave,
        onCancel: () => {},
      }),
    );

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存");
    if (!saveButton) throw new Error("save button not found");
    await click(saveButton);

    expect(onSave).toHaveBeenCalledWith("cat-work", "2026-05-15T22:00:00", "2026-05-16T00:00:00", "");
    await unmount(root);
  });

  it("renders the error returned from onSave (e.g. future endTime)", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: "不能记录尚未发生的时间" });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T09:00:00",
        endTime: "2026-05-20T22:00:00",
        onSave,
        onCancel: () => {},
      }),
    );

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存");
    if (!saveButton) throw new Error("save button not found");

    await click(saveButton);

    expect(host.querySelector('[data-testid="time-error"]')?.textContent).toBe("不能记录尚未发生的时间");
    await unmount(root);
  });

  it("disables the save button and shows progress while onSave is pending", async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T09:00:00",
        endTime: "2026-05-20T10:00:00",
        onSave,
        onCancel: () => {},
      }),
    );

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存");
    if (!saveButton) throw new Error("save button not found");

    await click(saveButton);

    expect(saveButton.disabled).toBe(true);
    expect(saveButton.textContent).toBe("保存中…");

    await act(async () => {
      resolveSave();
    });

    expect(saveButton.disabled).toBe(false);
    expect(saveButton.textContent).toBe("保存");
    await unmount(root);
  });

  it("merge up extends the start time to the previous entry without writing immediately", async () => {
    adjacentMock.value = {
      prevEntry: {
        id: "prev",
        categoryId: "cat-work",
        startTime: localDateTimeToUtc("2026-05-20T09:00:00"),
        endTime: localDateTimeToUtc("2026-05-20T10:00:00"),
      },
      nextEntry: null,
    };
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T10:00:00",
        endTime: "2026-05-20T11:00:00",
        onSave,
        onCancel: vi.fn(),
      }),
    );

    const mergeUp = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("向上合并"),
    );
    expect(mergeUp).toBeTruthy();

    await click(mergeUp);

    const categoryButton = Array.from(host.querySelectorAll("button")).find((button) =>
      ["选择分类", "cat-work"].includes(button.textContent ?? ""),
    );
    expect(categoryButton).toBeTruthy();
    await click(categoryButton);

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存");
    expect(saveButton).toBeTruthy();
    await click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][1]).toBe("2026-05-20T09:00:00");
    expect(onSave.mock.calls[0][2]).toBe("2026-05-20T11:00:00");
    await unmount(root);
  });

  it("merge up selects the previous entry category while extending the start time", async () => {
    adjacentMock.value = {
      prevEntry: {
        id: "prev",
        categoryId: "cat-sleep",
        startTime: localDateTimeToUtc("2026-05-20T09:00:00"),
        endTime: localDateTimeToUtc("2026-05-20T10:00:00"),
      },
      nextEntry: null,
    };
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T10:00:00",
        endTime: "2026-05-20T11:00:00",
        onSave,
        onCancel: vi.fn(),
      }),
    );

    const mergeUp = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("向上合并"),
    );
    expect(mergeUp).toBeTruthy();
    await click(mergeUp);

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存");
    expect(saveButton).toBeTruthy();
    await click(saveButton);

    expect(onSave).toHaveBeenCalledWith("cat-sleep", "2026-05-20T09:00:00", "2026-05-20T11:00:00", "");
    await unmount(root);
  });

  it("merge down selects the next entry category while extending the end time", async () => {
    adjacentMock.value = {
      prevEntry: null,
      nextEntry: {
        id: "next",
        categoryId: "cat-commute",
        startTime: localDateTimeToUtc("2026-05-20T11:00:00"),
        endTime: localDateTimeToUtc("2026-05-20T12:00:00"),
      },
    };
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T10:00:00",
        endTime: "2026-05-20T11:00:00",
        onSave,
        onCancel: vi.fn(),
      }),
    );

    const mergeDown = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("向下合并"),
    );
    expect(mergeDown).toBeTruthy();
    await click(mergeDown);

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存");
    expect(saveButton).toBeTruthy();
    await click(saveButton);

    expect(onSave).toHaveBeenCalledWith("cat-commute", "2026-05-20T10:00:00", "2026-05-20T12:00:00", "");
    await unmount(root);
  });

  it("hides both merge buttons when there is no adjacent entry", async () => {
    adjacentMock.value = { prevEntry: null, nextEntry: null };

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T10:00:00",
        endTime: "2026-05-20T11:00:00",
        onSave: vi.fn().mockResolvedValue({ ok: true }),
        onCancel: vi.fn(),
      }),
    );

    const mergeButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("合并"),
    );
    expect(mergeButton).toBeFalsy();
    await unmount(root);
  });
});
