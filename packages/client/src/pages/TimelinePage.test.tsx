import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { addDays, getDateString } from "../lib/time.js";
import TimelinePage from "./TimelinePage.js";

vi.mock("../components/DateNav.tsx", () => ({
  default: ({ date }: { date: string }) => createElement("div", null, `日期 ${date}`),
}));

vi.mock("../components/CircularTimeline.tsx", () => ({
  default: ({ overlay, onPunch }: { overlay?: React.ReactNode; onPunch?: () => void }) =>
    createElement(
      "div",
      { className: "circle", "data-has-punch": typeof onPunch === "function" ? "true" : "false" },
      overlay,
    ),
}));

vi.mock("../components/SyncIndicator.tsx", () => ({
  default: () => createElement("span", { "data-sync-indicator": "true" }, "sync-dot"),
}));

vi.mock("../components/Timeline.tsx", () => ({
  default: () => createElement("div", null, "timeline"),
}));

vi.mock("../hooks/useEntries.ts", () => ({
  useEntries: () => ({
    entries: [
      {
        id: "entry-1",
        categoryId: "cat-1",
        startTime: "2026-06-25T00:00:00.000Z",
        endTime: "2026-06-25T01:00:00.000Z",
        note: null,
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T01:00:00.000Z",
      },
    ],
    previousEntry: null,
  }),
  useEntryMutations: () => ({ deleteEntry: vi.fn() }),
}));

vi.mock("../lib/overnightDisplaySetting.ts", () => ({
  getMergeOvernightEnabled: () => true,
}));

describe("TimelinePage sync indicator", () => {
  it("passes SyncIndicator into the circular timeline overlay", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(TimelinePage)),
    );

    expect(html).toContain('data-sync-indicator="true"');
    expect(html).toContain("timeline");
  });

  it("passes a punch handler into the circular timeline", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(TimelinePage)),
    );
    expect(html).toContain('data-has-punch="true"');
  });

  it("does not render the standalone day overview coverage card", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(TimelinePage)),
    );

    expect(html).not.toContain("已记录");
    expect(html).not.toContain("覆盖 ");
    expect(html).not.toContain("个空档");
  });
});

describe("TimelinePage date 参数校验", () => {
  const today = getDateString(new Date());

  function renderWithDate(dateParam: string) {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [`/?date=${dateParam}`] },
        createElement(TimelinePage),
      ),
    );
  }

  it("非法月份不崩溃且回退今天", () => {
    expect(renderWithDate("2026-13-05")).toContain(`日期 ${today}`);
  });

  it("会被滚动的日期（02-31）回退今天", () => {
    expect(renderWithDate("2026-02-31")).toContain(`日期 ${today}`);
  });

  it("未来日期钳到今天", () => {
    expect(renderWithDate(addDays(today, 5))).toContain(`日期 ${today}`);
  });

  it("合法历史日期原样通过", () => {
    expect(renderWithDate("2026-01-15")).toContain("日期 2026-01-15");
  });
});
