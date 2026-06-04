// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { useHideBottomNavOnScroll } from "./useHideBottomNavOnScroll.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function render(element: ReactElement): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  return { host, root };
}

function tree(): ReactElement {
  return createElement(MemoryRouter, { initialEntries: ["/"] }, createElement(BottomNavProvider, null, createElement(Harness)));
}

async function scrollTo(host: HTMLDivElement, top: number): Promise<void> {
  const el = host.querySelector('[data-testid="scroller"]') as HTMLElement;
  Object.defineProperty(el, "scrollTop", { configurable: true, value: top });
  await act(async () => {
    el.dispatchEvent(new Event("scroll", { bubbles: false }));
  });
}

function hiddenText(host: HTMLDivElement): string | null | undefined {
  return host.querySelector('[data-testid="hidden"]')?.textContent;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("useHideBottomNavOnScroll", () => {
  it("向下滑过阈值后把底部导航置为隐藏", async () => {
    const { host, root } = await render(tree());
    expect(hiddenText(host)).toBe("false");

    await scrollTo(host, 0); // 首个事件作为基线种子
    await scrollTo(host, 40); // 向下 40，越过隐藏阈值

    expect(hiddenText(host)).toBe("true");
    await act(async () => root.unmount());
  });

  it("路由切换时把导航重置为显示", async () => {
    const { host, root } = await render(tree());

    await scrollTo(host, 0);
    await scrollTo(host, 60);
    expect(hiddenText(host)).toBe("true");

    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
    });

    expect(hiddenText(host)).toBe("false");
    await act(async () => root.unmount());
  });
});
