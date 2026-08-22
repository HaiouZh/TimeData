// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";

const getPlatformMock = vi.hoisted(() => vi.fn(() => "web"));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: getPlatformMock },
}));

import { useShellResizeGlide } from "./keyboardMotion.js";

function Probe({ animateSpy }: { animateSpy: (...args: unknown[]) => unknown }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useShellResizeGlide(ref);
  return createElement("div", {
    ref: (el: HTMLDivElement | null) => {
      ref.current = el;
      if (el) {
        (el as unknown as { animate: unknown }).animate = animateSpy;
      }
    },
  });
}

function setInnerHeight(value: number) {
  Object.defineProperty(window, "innerHeight", { value, configurable: true });
}

async function fireResize() {
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
  });
}

beforeEach(() => {
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue("android");
  setInnerHeight(800);
});

describe("useShellResizeGlide — 壳缩/恢复 webview 的单帧跳变用附加动画抹平", () => {
  it("壳缩 webview（innerHeight 变小）：从 +缩量 滑回 0（贴键盘的上滑变连续）", async () => {
    const animateSpy = vi.fn();
    const { root } = await renderDom(createElement(Probe, { animateSpy }));

    setInnerHeight(500);
    await fireResize();

    expect(animateSpy).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animateSpy.mock.calls[0] as [
      { transform: string }[],
      { composite?: string; duration?: number },
    ];
    expect(keyframes[0]?.transform).toBe("translateY(300px)");
    expect(keyframes[1]?.transform).toBe("translateY(0px)");
    // 必须是附加合成：基础 transform（抬升/滚动隐藏）另有其主，覆盖式动画会把它打断。
    expect(options.composite).toBe("add");

    await unmount(root);
  });

  it("壳恢复 webview（innerHeight 变大）：从 -恢复量 滑回 0（落下同样连续）", async () => {
    const animateSpy = vi.fn();
    const { root } = await renderDom(createElement(Probe, { animateSpy }));

    setInnerHeight(500);
    await fireResize();
    animateSpy.mockClear();

    setInnerHeight(800);
    await fireResize();

    const [keyframes] = animateSpy.mock.calls[0] as [{ transform: string }[]];
    expect(keyframes[0]?.transform).toBe("translateY(-300px)");
    expect(keyframes[1]?.transform).toBe("translateY(0px)");

    await unmount(root);
  });

  it("小幅变化（地址栏收合量级，<80px）不补偿", async () => {
    const animateSpy = vi.fn();
    const { root } = await renderDom(createElement(Probe, { animateSpy }));

    setInnerHeight(760);
    await fireResize();

    expect(animateSpy).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("web 平台（桌面拖窗）不补偿", async () => {
    getPlatformMock.mockReturnValue("web");
    const animateSpy = vi.fn();
    const { root } = await renderDom(createElement(Probe, { animateSpy }));

    setInnerHeight(500);
    await fireResize();

    expect(animateSpy).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("元素无 animate（旧 WebView / jsdom）时静默跳过不炸", async () => {
    const { root } = await renderDom(
      createElement(function NoAnimateProbe() {
        const ref = useRef<HTMLDivElement | null>(null);
        useShellResizeGlide(ref);
        return createElement("div", { ref });
      }),
    );

    setInnerHeight(500);
    await fireResize();

    await unmount(root);
  });
});
