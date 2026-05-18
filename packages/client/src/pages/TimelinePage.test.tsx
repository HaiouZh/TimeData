import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import TimelinePage from "./TimelinePage.js";

const syncIfStaleMock = vi.hoisted(() => vi.fn());

vi.mock("../contexts/SyncContext.tsx", () => ({
  useSyncContext: () => ({
    syncIfStale: syncIfStaleMock,
    status: "success",
  }),
}));

vi.mock("../components/DateNav.tsx", () => ({
  default: ({ date }: { date: string }) => createElement("div", null, `日期 ${date}`),
}));

vi.mock("../components/CircularTimeline.tsx", () => ({
  default: ({ overlay }: { overlay?: React.ReactNode }) => createElement("div", { className: "circle" }, overlay),
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
});
