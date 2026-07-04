// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import { SPLIT_DEFAULT } from "../../lib/tasks/workbenchPrefs.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { ResizableSplit } from "./ResizableSplit.js";

const localStorageMock = (() => {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

async function renderSplit() {
  const { host, root } = await renderDom(
    createElement(ResizableSplit, { left: createElement("p", null, "左"), right: createElement("p", null, "右") }),
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
});
