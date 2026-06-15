import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import TimelinePage from "./TimelinePage.js";

const syncIfStaleMock = vi.hoisted(() => vi.fn());

vi.mock("../contexts/SyncContext.tsx", () => ({
  useSyncContext: () => ({
    syncIfStale: syncIfStaleMock,
    syncAfterWrite: vi.fn(),
    status: "success",
  }),
}));

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
  useEntries: () => ({ entries: [], previousEntry: null }),
}));

vi.mock("../lib/overnightDisplaySetting.ts", () => ({
  getMergeOvernightEnabled: () => true,
}));

describe("TimelinePage sync indicator", () => {
  it("passes SyncIndicator into the circular timeline overlay", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(TimelinePage, { refreshKey: 0 })),
    );

    expect(html).toContain('data-sync-indicator="true"');
    expect(html).toContain("timeline");
  });

  it("passes a punch handler into the circular timeline", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(TimelinePage, { refreshKey: 0 })),
    );
    expect(html).toContain('data-has-punch="true"');
  });
});
