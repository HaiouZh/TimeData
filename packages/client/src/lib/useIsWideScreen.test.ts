// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsWideScreen } from "./useIsWideScreen.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function renderHook(): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  function Probe() {
    const wide = useIsWideScreen();
    return createElement("span", { "data-wide": String(wide) });
  }

  await act(async () => root.render(createElement(Probe)));
  return { host, root };
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

    await act(async () => root.unmount());
  });

  it("订阅 change 并在卸载时清理", async () => {
    const media = installMatchMedia(false);
    const { host, root } = await renderHook();

    expect(host.firstElementChild?.getAttribute("data-wide")).toBe("false");
    expect(media.mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    await act(async () => media.setMatches(true));
    expect(host.firstElementChild?.getAttribute("data-wide")).toBe("true");

    await act(async () => root.unmount());
    expect(media.mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("无 matchMedia 时安全返回 false", async () => {
    Object.defineProperty(window, "matchMedia", { value: undefined, configurable: true });
    const { host, root } = await renderHook();

    expect(host.firstElementChild?.getAttribute("data-wide")).toBe("false");

    await act(async () => root.unmount());
  });
});
