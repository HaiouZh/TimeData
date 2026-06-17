// @vitest-environment jsdom
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchoredPopover } from "./AnchoredPopover.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubViewport(): void {
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
}

async function renderPopover(children: ReactNode, onClose = vi.fn()) {
  stubViewport();
  const anchor = document.createElement("button");
  anchor.textContent = "anchor";
  document.body.appendChild(anchor);
  Object.defineProperty(anchor, "getBoundingClientRect", {
    value: vi.fn(() => ({
      x: 200,
      y: 650,
      left: 200,
      top: 650,
      right: 280,
      bottom: 674,
      width: 80,
      height: 24,
      toJSON: () => ({}),
    })),
    configurable: true,
  });
  anchor.focus();

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        AnchoredPopover,
        { open: true, anchorRef: { current: anchor }, onClose, ariaLabel: "测试浮层" },
        children,
      ),
    );
  });
  await act(async () => undefined);

  return { anchor, root };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("AnchoredPopover", () => {
  it("内容尺寸变化时重新计算位置", async () => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function ResizeObserverMock(callback: ResizeObserverCallback) {
        resize = callback;
        return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
      }),
    );

    let panelHeight = 100;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element): DOMRect {
      if (this.getAttribute("role") === "dialog") {
        return {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 240,
          bottom: panelHeight,
          width: 240,
          height: panelHeight,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const { root } = await renderPopover(createElement("button", null, "选项"));
    const panel = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel.style.top).toBe("680px");
    expect(resize).toBeTypeOf("function");

    panelHeight = 260;
    expect(panel.getBoundingClientRect().height).toBe(260);
    await act(async () => {
      resize?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
      await Promise.resolve();
    });

    expect(panel.style.top).toBe("384px");
    await act(async () => root.unmount());
  });

  it("打开时聚焦首个控件，关闭时恢复到锚点", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      const anchor = document.querySelector("[data-anchor]") as HTMLButtonElement | null;
      return anchor
        ? createElement(
            AnchoredPopover,
            { open, anchorRef: { current: anchor }, onClose: () => setOpen(false), ariaLabel: "测试浮层" },
            createElement("button", null, "第一项"),
          )
        : null;
    }

    stubViewport();
    const anchor = document.createElement("button");
    anchor.dataset.anchor = "true";
    document.body.appendChild(anchor);
    anchor.focus();
    Object.defineProperty(anchor, "getBoundingClientRect", {
      value: vi.fn(() => ({
        x: 20,
        y: 20,
        left: 20,
        top: 20,
        right: 80,
        bottom: 44,
        width: 60,
        height: 24,
        toJSON: () => ({}),
      })),
      configurable: true,
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Harness)));
    await act(async () => undefined);

    expect(document.activeElement?.textContent).toBe("第一项");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => undefined);

    expect(document.activeElement).toBe(anchor);
    await act(async () => root.unmount());
  });
});
