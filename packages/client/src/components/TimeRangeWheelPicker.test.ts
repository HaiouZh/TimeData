import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TimeRangeWheelPicker, { wheelIndexFromScrollTop, wheelScrollTopForIndex } from "./TimeRangeWheelPicker.js";

describe("wheel scroll positioning", () => {
  it("centers the same item that settle reads back", () => {
    expect(wheelIndexFromScrollTop(wheelScrollTopForIndex(0))).toBe(0);
    expect(wheelIndexFromScrollTop(wheelScrollTopForIndex(23))).toBe(23);
    expect(wheelIndexFromScrollTop(wheelScrollTopForIndex(59))).toBe(59);
  });
});

describe("TimeRangeWheelPicker", () => {
  it("shows overnight duration using the same resolved range as saving", () => {
    const html = renderToStaticMarkup(
      createElement(TimeRangeWheelPicker, {
        start: { date: "2026-05-08", hour: "23", minute: "53" },
        end: { date: "2026-05-08", hour: "08", minute: "01" },
        onStartChange: () => {},
        onEndChange: () => {},
      })
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
      })
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
      })
    );
    expect(html).not.toContain("transition-all");
    expect(html).not.toContain("scale-110");
  });
});
