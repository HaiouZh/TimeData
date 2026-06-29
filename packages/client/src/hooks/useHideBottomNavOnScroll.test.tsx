// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { renderDom, unmount } from "../test/domHarness.js";
import { useHideBottomNavOnScroll } from "./useHideBottomNavOnScroll.js";

function Harness() {
  const onScroll = useHideBottomNavOnScroll();
  const { hidden } = useBottomNav();
  const navigate = useNavigate();
  return createElement(
    "div",
    null,
    createElement("div", { "data-testid": "scroller", onScroll }),
    createElement("span", { "data-testid": "hidden" }, String(hidden)),
    createElement("button", { type: "button", onClick: () => navigate("/stats") }, "go"),
  );
}

function tree(): ReactElement {
  return createElement(
    MemoryRouter,
    { initialEntries: ["/"] },
    createElement(BottomNavProvider, null, createElement(Harness)),
  );
}

async function scrollTo(host: HTMLElement, top: number): Promise<void> {
  const el = host.querySelector('[data-testid="scroller"]') as HTMLElement;
  Object.defineProperty(el, "scrollTop", { configurable: true, value: top });
  await act(async () => {
    el.dispatchEvent(new Event("scroll", { bubbles: false }));
  });
}

function hiddenText(host: HTMLElement): string | null | undefined {
  return host.querySelector('[data-testid="hidden"]')?.textContent;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("useHideBottomNavOnScroll", () => {
  it("向下滑过阈值后把底部导航置为隐藏", async () => {
    const { host, root } = await renderDom(tree());
    expect(hiddenText(host)).toBe("false");

    await scrollTo(host, 0); // 首个事件作为基线种子
    await scrollTo(host, 40); // 向下 40，越过隐藏阈值

    expect(hiddenText(host)).toBe("true");
    await unmount(root);
  });

  it("路由切换时把导航重置为显示", async () => {
    const { host, root } = await renderDom(tree());

    await scrollTo(host, 0);
    await scrollTo(host, 60);
    expect(hiddenText(host)).toBe("true");

    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
    });

    expect(hiddenText(host)).toBe("false");
    await unmount(root);
  });

  it("隐藏切换后的过渡期内只刷新滚动基线，不因被动上滚立刻显示", async () => {
    vi.useFakeTimers();
    try {
      const { host, root } = await renderDom(tree());

      await scrollTo(host, 100);
      await scrollTo(host, 140);
      expect(hiddenText(host)).toBe("true");

      await scrollTo(host, 128);
      expect(hiddenText(host)).toBe("true");

      vi.advanceTimersByTime(300);
      await scrollTo(host, 116);
      expect(hiddenText(host)).toBe("false");

      await unmount(root);
    } finally {
      vi.useRealTimers();
    }
  });
});
