// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInView } from "./useInView.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return createElement("div", { ref, "data-in-view": String(inView) });
}

describe("useInView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("初始 inView=false 并 observe 元素", async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observe;
        disconnect = disconnect;
        constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
      },
    );
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(Probe));
    });

    expect(host.firstElementChild?.getAttribute("data-in-view")).toBe("false");
    expect(observe).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("无 IntersectionObserver 时降级为已进入视口", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(Probe));
    });

    expect(host.firstElementChild?.getAttribute("data-in-view")).toBe("true");

    await act(async () => {
      root.unmount();
    });
  });
});
