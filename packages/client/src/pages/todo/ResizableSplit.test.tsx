// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import { DIARY_SPLIT_PREFS, SPLIT_DEFAULT, type SplitPrefs } from "../../lib/tasks/workbenchPrefs.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { ResizableSplit } from "./ResizableSplit.js";

async function renderSplit(prefs?: SplitPrefs) {
  const { host, root } = await renderDom(
    createElement(ResizableSplit, {
      left: createElement("p", null, "左"),
      right: createElement("p", null, "右"),
      ...(prefs ? { prefs } : {}),
    }),
  );
  const split = host.firstElementChild as HTMLElement;
  vi.spyOn(split, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 400,
    width: 1000,
    height: 400,
    toJSON: () => ({}),
  } as DOMRect);
  return { host, root };
}

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ResizableSplit", () => {
  it("拖动分隔条更新比例，并在 pointerup 保存", async () => {
    const { host, root } = await renderSplit();
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    await act(async () => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 500, pointerId: 1 }));
      handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 700, pointerId: 1 }));
      handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 700, pointerId: 1 }));
    });

    expect((host.firstElementChild as HTMLElement).style.gridTemplateColumns).toContain("0.7fr");
    expect(localStorage.getItem(STORAGE_KEYS.todoWorkbenchSplit)).toBe("0.7");

    await unmount(root);
  });

  it("双击分隔条重置为默认比例并保存", async () => {
    localStorage.setItem(STORAGE_KEYS.todoWorkbenchSplit, "0.5");
    const { host, root } = await renderSplit();
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    await act(async () => {
      handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect((host.firstElementChild as HTMLElement).style.gridTemplateColumns).toContain(`${SPLIT_DEFAULT}fr`);
    expect(localStorage.getItem(STORAGE_KEYS.todoWorkbenchSplit)).toBe(String(SPLIT_DEFAULT));

    await unmount(root);
  });

  it("支持键盘调整并保存比例", async () => {
    const { host, root } = await renderSplit();
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });

    expect((host.firstElementChild as HTMLElement).style.gridTemplateColumns).toContain("0.7fr");
    expect(localStorage.getItem(STORAGE_KEYS.todoWorkbenchSplit)).toBe("0.7");

    await unmount(root);
  });

  it("左右栏默认保留块间距", async () => {
    const { host, root } = await renderSplit();
    const sections = host.querySelectorAll("section");

    expect(sections[0].className).toContain("space-y-4");
    expect(sections[1].className).toContain("space-y-4");

    await unmount(root);
  });

  it("传 diary prefs 时存进日记自己的键，且按日记范围夹取", async () => {
    const { host, root } = await renderSplit(DIARY_SPLIT_PREFS);
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });

    // End 键推到最大：日记范围上限 0.85，不是待办的 0.7
    expect((host.firstElementChild as HTMLElement).style.gridTemplateColumns).toContain("0.85fr");
    expect(localStorage.getItem(STORAGE_KEYS.diarySplit)).toBe("0.85");
    expect(localStorage.getItem(STORAGE_KEYS.todoWorkbenchSplit)).toBeNull();

    await unmount(root);
  });

  // 键盘那条走的是 applyAndSaveRatio，碰不到 finishDrag。拖拽收尾（pointerup）是另一条
  // 独立的保存路径，它的 prefs 透传若丢了，日记的拖拽结果会静默存进待办页的键。
  it("传 diary prefs 时拖拽 pointerup 也存进日记自己的键", async () => {
    const { host, root } = await renderSplit(DIARY_SPLIT_PREFS);
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    await act(async () => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 500, pointerId: 1 }));
      handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 800, pointerId: 1 }));
      handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 800, pointerId: 1 }));
    });

    // 0.8 在日记范围 [0.5,0.85] 内合法；若误用待办范围会被夹到 0.7。
    expect(localStorage.getItem(STORAGE_KEYS.diarySplit)).toBe("0.8");
    expect(localStorage.getItem(STORAGE_KEYS.todoWorkbenchSplit)).toBeNull();

    await unmount(root);
  });

  it("传 diary prefs 时 aria 范围随之变化", async () => {
    const { host, root } = await renderSplit(DIARY_SPLIT_PREFS);
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    expect(handle.getAttribute("aria-valuemin")).toBe("50");
    expect(handle.getAttribute("aria-valuemax")).toBe("85");

    await unmount(root);
  });

  it("不传 prefs 时 aria 范围仍是待办页的 35/70", async () => {
    const { host, root } = await renderSplit();
    const handle = host.querySelector('[role="separator"]') as HTMLElement;

    expect(handle.getAttribute("aria-valuemin")).toBe("35");
    expect(handle.getAttribute("aria-valuemax")).toBe("70");

    await unmount(root);
  });
});
