// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, getDateString } from "../lib/time.js";
import TimelinePage from "./TimelinePage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/punch.ts", () => ({ punchNow: vi.fn() }));
vi.mock("../hooks/useEntries.ts", () => ({
  useEntries: () => ({ entries: [], previousEntry: null }),
  useEntryMutations: () => ({ deleteEntry: vi.fn() }),
}));
vi.mock("../components/DateNav.tsx", () => ({
  default: ({ date }: { date: string }) => createElement("div", { "data-testid": "date" }, date),
}));
vi.mock("../components/SyncIndicator.tsx", () => ({ default: () => null }));
vi.mock("../components/CircularTimeline.tsx", () => ({
  default: () => createElement("div", { "data-testid": "ring" }, "ring"),
}));
vi.mock("../components/Timeline.tsx", () => ({ default: () => createElement("div", null, "list") }));
vi.mock("../lib/overnightDisplaySetting.ts", () => ({ getMergeOvernightEnabled: () => false }));

const today = getDateString(new Date());

describe("TimelinePage 横滑切日 (TL-09)", () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  async function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(MemoryRouter, null, createElement(TimelinePage)));
    });
  }

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    host?.remove();
  });

  async function swipe(target: Element, fromX: number, toX: number, y = 300, pointerType = "touch") {
    await act(async () => {
      target.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: fromX, clientY: y, pointerId: 7, pointerType }),
      );
      target.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: toX, clientY: y, pointerId: 7, pointerType }),
      );
    });
  }

  it("列表区右滑=前一天，左滑回来=今天", async () => {
    await mount();
    const container = host.querySelector('[data-testid="swipe-area"]');
    if (!container) throw new Error("swipe area not found");

    await swipe(container, 60, 200);
    expect(host.querySelector('[data-testid="date"]')?.textContent).toBe(addDays(today, -1));

    await swipe(container, 200, 60);
    expect(host.querySelector('[data-testid="date"]')?.textContent).toBe(today);
  });

  it("今天视图左滑（去明天）无效", async () => {
    await mount();
    const container = host.querySelector('[data-testid="swipe-area"]');
    if (!container) throw new Error("swipe area not found");

    await swipe(container, 200, 60);
    expect(host.querySelector('[data-testid="date"]')?.textContent).toBe(today);
  });

  it("位移不足阈值不触发", async () => {
    await mount();
    const container = host.querySelector('[data-testid="swipe-area"]');
    if (!container) throw new Error("swipe area not found");

    await swipe(container, 100, 140);
    expect(host.querySelector('[data-testid="date"]')?.textContent).toBe(today);
  });

  it("垂直为主不触发", async () => {
    await mount();
    const container = host.querySelector('[data-testid="swipe-area"]');
    if (!container) throw new Error("swipe area not found");

    await act(async () => {
      container.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, pointerId: 7, pointerType: "touch" }),
      );
      container.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 180, clientY: 160, pointerId: 7, pointerType: "touch" }),
      );
    });
    expect(host.querySelector('[data-testid="date"]')?.textContent).toBe(today);
  });

  it("触点起于圆环区域不参与切日", async () => {
    await mount();
    const ring = host.querySelector('[data-testid="ring"]');
    if (!ring) throw new Error("ring not found");

    await swipe(ring, 60, 200);
    expect(host.querySelector('[data-testid="date"]')?.textContent).toBe(today);
  });

  it("鼠标拖动不切日", async () => {
    await mount();
    const container = host.querySelector('[data-testid="swipe-area"]');
    if (!container) throw new Error("swipe area not found");

    await swipe(container, 60, 200, 300, "mouse");
    expect(host.querySelector('[data-testid="date"]')?.textContent).toBe(today);
  });
});
