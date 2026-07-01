// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import { TRAY_WIDTH_DEFAULT, TRAY_WIDTH_MAX, TRAY_WIDTH_MIN } from "./goalTrayPrefs.js";
import { ResizableTrayAside } from "./ResizableTrayAside.js";

const localStorageMock = (() => {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
});

afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
  localStorage.clear();
});

async function render() {
  mounted = await renderDom(
    <ResizableTrayAside>
      <p>内容</p>
    </ResizableTrayAside>,
  );
  return mounted;
}

function aside(host: ParentNode): HTMLElement {
  const el = host.querySelector('aside[data-drawer="tray"]');
  if (!(el instanceof HTMLElement)) throw new Error("missing tray aside");
  return el;
}

function handle(host: ParentNode): HTMLElement {
  const el = host.querySelector('[role="separator"]');
  if (!(el instanceof HTMLElement)) throw new Error("missing handle");
  return el;
}

describe("ResizableTrayAside", () => {
  it("保留 aria-label 与 data-drawer 契约、默认宽度", async () => {
    const rendered = await render();
    const el = aside(rendered.host);
    expect(el.getAttribute("aria-label")).toBe("未归类托盘");
    expect(el.getAttribute("data-drawer")).toBe("tray");
    expect(el.style.width).toBe(`${TRAY_WIDTH_DEFAULT}px`);
  });

  it("拖动左边缘更新宽度并在 pointerup 保存（宽度=innerWidth-clientX，夹取）", async () => {
    const rendered = await render();
    const h = handle(rendered.host);

    await act(async () => {
      h.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 500, pointerId: 1 }));
      h.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 400, pointerId: 1 }));
      h.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 400, pointerId: 1 }));
    });

    // innerWidth 1000 - clientX 400 = 600（在 [280,640] 内）
    expect(aside(rendered.host).style.width).toBe("600px");
    expect(localStorage.getItem(STORAGE_KEYS.goalTrayWidth)).toBe("600");
  });

  it("超出范围时夹到边界", async () => {
    const rendered = await render();
    const h = handle(rendered.host);

    await act(async () => {
      h.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 500, pointerId: 1 }));
      h.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 100, pointerId: 1 })); // 900 → 640
      h.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 100, pointerId: 1 }));
    });

    expect(aside(rendered.host).style.width).toBe(`${TRAY_WIDTH_MAX}px`);
    expect(localStorage.getItem(STORAGE_KEYS.goalTrayWidth)).toBe(String(TRAY_WIDTH_MAX));
  });

  it("双击手柄复位为默认并保存", async () => {
    localStorage.setItem(STORAGE_KEYS.goalTrayWidth, "500");
    const rendered = await render();
    expect(aside(rendered.host).style.width).toBe("500px"); // 初始读回持久化值

    await act(async () => {
      handle(rendered.host).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(aside(rendered.host).style.width).toBe(`${TRAY_WIDTH_DEFAULT}px`);
    expect(localStorage.getItem(STORAGE_KEYS.goalTrayWidth)).toBe(String(TRAY_WIDTH_DEFAULT));
  });

  it("键盘 End 收窄到 MIN 并保存", async () => {
    const rendered = await render();

    await act(async () => {
      handle(rendered.host).dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });

    expect(aside(rendered.host).style.width).toBe(`${TRAY_WIDTH_MIN}px`);
    expect(localStorage.getItem(STORAGE_KEYS.goalTrayWidth)).toBe(String(TRAY_WIDTH_MIN));
  });
});
