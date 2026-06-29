// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import { useInView } from "./useInView.js";

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
      },
    );
    const { host, root } = await renderDom(createElement(Probe));

    expect(host.firstElementChild?.getAttribute("data-in-view")).toBe("false");
    expect(observe).toHaveBeenCalledTimes(1);

    await unmount(root);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("无 IntersectionObserver 时降级为已进入视口", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { host, root } = await renderDom(createElement(Probe));

    expect(host.firstElementChild?.getAttribute("data-in-view")).toBe("true");

    await unmount(root);
  });
});
