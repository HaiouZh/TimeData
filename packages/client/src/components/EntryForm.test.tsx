// @vitest-environment jsdom
import type { TimeEntry } from "@timedata/shared";
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

type AdjacentEntry = { id: string; categoryId: string; startTime: string; endTime: string; note?: string | null };

const adjacentMock = vi.hoisted(() => ({
  value: {
    prevEntry: null as null | AdjacentEntry,
    nextEntry: null as null | AdjacentEntry,
  },
}));

function entryWithNote(note: string | null): TimeEntry {
  return {
    id: "current",
    categoryId: "cat-work",
    startTime: localDateTimeToUtc("2026-05-20T10:00:00"),
    endTime: localDateTimeToUtc("2026-05-20T11:00:00"),
    note,
    createdAt: "2026-05-20T02:00:00.000Z",
    updatedAt: "2026-05-20T02:00:00.000Z",
  };
}

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

  // 键盘避让的滚动空间挂点：短表单整页放得下时滚动容器无溢出，Bridge 的显式差值滚动会被 clamp 在 0
  //（备注框被键盘盖住）。根容器挂 keyboard-scroll-pad（index.css 消费 --keyboard-scroll-padding）才滚得动。
  it("根容器带 keyboard-scroll-pad 类（键盘滚动空间的挂点，见 index.css）", async () => {
    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T09:00:00",
        endTime: "2026-05-20T22:00:00",
        onSave: vi.fn(),
        onCancel: () => {},
      }),
    );

    const rootContainer = host.firstElementChild;
    expect(rootContainer?.className).toContain("keyboard-scroll-pad");
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

  it("merge up keeps both notes, previous entry note first", async () => {
    adjacentMock.value = {
      prevEntry: {
        id: "prev",
        categoryId: "cat-work",
        startTime: localDateTimeToUtc("2026-05-20T09:00:00"),
        endTime: localDateTimeToUtc("2026-05-20T10:00:00"),
        note: "开会讨论排期",
      },
      nextEntry: null,
    };
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T10:00:00",
        endTime: "2026-05-20T11:00:00",
        existingEntry: entryWithNote("继续写方案"),
        onSave,
        onCancel: vi.fn(),
      }),
    );

    const mergeUp = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("向上合并"),
    );
    await click(mergeUp);

    // 合并是表单层的编辑：并进来的备注要肉眼可见、可再改。
    expect(host.querySelector("textarea")?.value).toBe("开会讨论排期\n继续写方案");

    const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存");
    await click(saveButton);

    expect(onSave).toHaveBeenCalledWith(
      "cat-work",
      "2026-05-20T09:00:00",
      "2026-05-20T11:00:00",
      "开会讨论排期\n继续写方案",
    );
    await unmount(root);
  });

  it("merge up adopts the previous entry note when the current note is empty", async () => {
    adjacentMock.value = {
      prevEntry: {
        id: "prev",
        categoryId: "cat-work",
        startTime: localDateTimeToUtc("2026-05-20T09:00:00"),
        endTime: localDateTimeToUtc("2026-05-20T10:00:00"),
        note: "开会讨论排期",
      },
      nextEntry: null,
    };
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T10:00:00",
        endTime: "2026-05-20T11:00:00",
        existingEntry: entryWithNote(null),
        onSave,
        onCancel: vi.fn(),
      }),
    );

    await click(Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("向上合并")));
    await click(Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存"));

    expect(onSave).toHaveBeenCalledWith("cat-work", "2026-05-20T09:00:00", "2026-05-20T11:00:00", "开会讨论排期");
    await unmount(root);
  });

  it("merge up leaves the current note untouched when the previous entry has none", async () => {
    adjacentMock.value = {
      prevEntry: {
        id: "prev",
        categoryId: "cat-work",
        startTime: localDateTimeToUtc("2026-05-20T09:00:00"),
        endTime: localDateTimeToUtc("2026-05-20T10:00:00"),
        note: null,
      },
      nextEntry: null,
    };
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T10:00:00",
        endTime: "2026-05-20T11:00:00",
        existingEntry: entryWithNote("继续写方案"),
        onSave,
        onCancel: vi.fn(),
      }),
    );

    await click(Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("向上合并")));
    await click(Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存"));

    expect(onSave).toHaveBeenCalledWith("cat-work", "2026-05-20T09:00:00", "2026-05-20T11:00:00", "继续写方案");
    await unmount(root);
  });

  it("merge up twice on the same previous entry does not duplicate its note", async () => {
    adjacentMock.value = {
      prevEntry: {
        id: "prev",
        categoryId: "cat-work",
        startTime: localDateTimeToUtc("2026-05-20T09:00:00"),
        endTime: localDateTimeToUtc("2026-05-20T10:00:00"),
        note: "开会讨论排期",
      },
      nextEntry: null,
    };
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T10:00:00",
        endTime: "2026-05-20T11:00:00",
        existingEntry: entryWithNote("继续写方案"),
        onSave,
        onCancel: vi.fn(),
      }),
    );

    // 相邻查询是 live query，连点两下时上一条可能还没换人。
    const mergeUp = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("向上合并"),
    );
    await click(mergeUp);
    await click(mergeUp);

    expect(host.querySelector("textarea")?.value).toBe("开会讨论排期\n继续写方案");
    await unmount(root);
  });

  it("merge down keeps both notes, current note first", async () => {
    adjacentMock.value = {
      prevEntry: null,
      nextEntry: {
        id: "next",
        categoryId: "cat-commute",
        startTime: localDateTimeToUtc("2026-05-20T11:00:00"),
        endTime: localDateTimeToUtc("2026-05-20T12:00:00"),
        note: "回家路上",
      },
    };
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    const { host, root } = await renderDom(
      createElement(EntryForm, {
        startTime: "2026-05-20T10:00:00",
        endTime: "2026-05-20T11:00:00",
        existingEntry: entryWithNote("继续写方案"),
        onSave,
        onCancel: vi.fn(),
      }),
    );

    await click(Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("向下合并")));

    expect(host.querySelector("textarea")?.value).toBe("继续写方案\n回家路上");

    await click(Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "保存"));

    expect(onSave).toHaveBeenCalledWith("cat-commute", "2026-05-20T10:00:00", "2026-05-20T12:00:00", "继续写方案\n回家路上");
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
