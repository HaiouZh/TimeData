// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Root, renderDom, unmount } from "../test/domHarness.js";
import { useIsWideScreen } from "./useIsWideScreen.js";

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    media: "(min-width: 1024px)",
    get matches() {
      return matches;
    },
    onchange: null,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === "change") listeners.add(listener as (event: MediaQueryListEvent) => void);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === "change") listeners.delete(listener as (event: MediaQueryListEvent) => void);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;
  const matchMedia = vi.fn(() => mql);
  // stubGlobal 而非 defineProperty(window)：桶 afterEach 的 unstubAllGlobals 能自动复位，isolate:false 下不跨文件泄漏。
  vi.stubGlobal("matchMedia", matchMedia);

  return {
    matchMedia,
    mql,
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next, media: mql.media } as MediaQueryListEvent);
      }
    },
  };
}

async function renderHook(): Promise<{ host: HTMLElement; root: Root }> {
  function Probe() {
    const wide = useIsWideScreen();
    return createElement("span", { "data-wide": String(wide) });
  }

  return renderDom(createElement(Probe));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useIsWideScreen", () => {
  it("读取 (min-width: 1024px) 的当前 matches", async () => {
    const media = installMatchMedia(true);
    const { host, root } = await renderHook();

    expect(media.matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(host.firstElementChild?.getAttribute("data-wide")).toBe("true");

    await unmount(root);
  });

  it("订阅 change 并在卸载时清理", async () => {
    const media = installMatchMedia(false);
    const { host, root } = await renderHook();

    expect(host.firstElementChild?.getAttribute("data-wide")).toBe("false");
    expect(media.mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    await act(async () => media.setMatches(true));
    expect(host.firstElementChild?.getAttribute("data-wide")).toBe("true");

    await unmount(root);
    expect(media.mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("无 matchMedia 时安全返回 false", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const { host, root } = await renderHook();

    expect(host.firstElementChild?.getAttribute("data-wide")).toBe("false");

    await unmount(root);
  });
});
