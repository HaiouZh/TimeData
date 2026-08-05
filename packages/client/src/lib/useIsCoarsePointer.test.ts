// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import { useIsCoarsePointer } from "./useIsCoarsePointer.js";

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    media: "(pointer: coarse)",
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
  Object.defineProperty(window, "matchMedia", { value: matchMedia, configurable: true });

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

function renderHook(): Promise<{ host: HTMLElement; root: Awaited<ReturnType<typeof renderDom>>["root"] }> {
  function Probe() {
    const coarse = useIsCoarsePointer();
    return createElement("span", { "data-coarse": String(coarse) });
  }

  return renderDom(createElement(Probe));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  // 裸 defineProperty 桩不在 restoreAllMocks/unstubAllGlobals 管辖内；isolate:false 下 jsdom
  // 环境跨文件共享，文件内用例 shuffle 后末条可能是 matches=true/false 的 matchMedia 桩，
  // 会以该值污染后续文件的 useIsWideScreen 判定（如 TracksListPage 宽屏布局断言），显式摘掉。
  Reflect.deleteProperty(window, "matchMedia");
});

describe("useIsCoarsePointer", () => {
  it("读取 (pointer: coarse) 的当前 matches", async () => {
    const media = installMatchMedia(true);
    const { host, root } = await renderHook();

    expect(media.matchMedia).toHaveBeenCalledWith("(pointer: coarse)");
    expect(host.firstElementChild?.getAttribute("data-coarse")).toBe("true");

    await unmount(root);
  });

  it("订阅 change 并在卸载时清理", async () => {
    const media = installMatchMedia(false);
    const { host, root } = await renderHook();

    expect(host.firstElementChild?.getAttribute("data-coarse")).toBe("false");
    expect(media.mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    await act(async () => media.setMatches(true));
    expect(host.firstElementChild?.getAttribute("data-coarse")).toBe("true");

    await unmount(root);
    expect(media.mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("无 matchMedia 时安全返回 false", async () => {
    Object.defineProperty(window, "matchMedia", { value: undefined, configurable: true });
    const { host, root } = await renderHook();

    expect(host.firstElementChild?.getAttribute("data-coarse")).toBe("false");

    await unmount(root);
  });
});
