// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import TimeRangeWheelPicker, { wheelIndexFromScrollTop, wheelScrollTopForIndex } from "./TimeRangeWheelPicker.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("wheel scroll positioning", () => {
  it("centers the same item that settle reads back", () => {
    expect(wheelIndexFromScrollTop(wheelScrollTopForIndex(0))).toBe(0);
    expect(wheelIndexFromScrollTop(wheelScrollTopForIndex(23))).toBe(23);
    expect(wheelIndexFromScrollTop(wheelScrollTopForIndex(59))).toBe(59);
  });
});

describe("TimeRangeWheelPicker", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("clears pending wheel settle timers when unmounted", () => {
    vi.useFakeTimers();
    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    const root = createRoot(rootElement);
    const onStartChange = vi.fn();
    const onEndChange = vi.fn();

    act(() => {
      root.render(
        createElement(TimeRangeWheelPicker, {
          start: { date: "2026-05-15", hour: "09", minute: "00" },
          end: { date: "2026-05-15", hour: "10", minute: "00" },
          onStartChange,
          onEndChange,
        }),
      );
    });

    const hourWheel = rootElement.querySelector<HTMLDivElement>("[role='listbox']");
    expect(hourWheel).not.toBeNull();
    act(() => {
      hourWheel!.scrollTop = wheelScrollTopForIndex(11 * 24 + 11);
      hourWheel!.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => {
      root.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(70);
    });

    expect(onStartChange).not.toHaveBeenCalled();
    expect(onEndChange).not.toHaveBeenCalled();
  });

  it("shows overnight duration using the same resolved range as saving", () => {
    const html = renderToStaticMarkup(
      createElement(TimeRangeWheelPicker, {
        start: { date: "2026-05-08", hour: "23", minute: "53" },
        end: { date: "2026-05-08", hour: "08", minute: "01" },
        onStartChange: () => {},
        onEndChange: () => {},
      }),
    );

    expect(html).toContain("8小时8分钟");
    expect(html).not.toContain("0分钟");
  });
});

describe("TimeRangeWheelPicker scroll container", () => {
  it("uses wheel-scroll class so iOS WebKit can hide the scrollbar", () => {
    const html = renderToStaticMarkup(
      createElement(TimeRangeWheelPicker, {
        start: { date: "2026-05-15", hour: "09", minute: "00" },
        end: { date: "2026-05-15", hour: "10", minute: "00" },
        onStartChange: () => {},
        onEndChange: () => {},
      }),
    );
    expect(html).toContain("wheel-scroll");
    expect(html).not.toMatch(/style="[^"]*scrollbar-width/);
  });

  it("does not animate transform or font-weight on selection (avoids horizontal jitter during scroll-snap)", () => {
    const html = renderToStaticMarkup(
      createElement(TimeRangeWheelPicker, {
        start: { date: "2026-05-15", hour: "09", minute: "00" },
        end: { date: "2026-05-15", hour: "10", minute: "00" },
        onStartChange: () => {},
        onEndChange: () => {},
      }),
    );
    expect(html).not.toContain("transition-all");
    expect(html).not.toContain("scale-110");
  });
});
