// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TimelinePage from "./TimelinePage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/punch.ts", () => ({ punchNow: vi.fn() }));
vi.mock("../hooks/useEntries.ts", () => ({
  useEntries: () => ({ entries: [], previousEntry: null }),
  useEntryMutations: () => ({ deleteEntry: vi.fn() }),
}));
vi.mock("../components/DateNav.tsx", () => ({
  default: ({ onDateChange }: { onDateChange: (d: string) => void }) =>
    createElement("button", { "data-testid": "prev-day", onClick: () => onDateChange("2026-01-15") }, "prev"),
}));
vi.mock("../components/SyncIndicator.tsx", () => ({ default: () => null }));
vi.mock("../components/CircularTimeline.tsx", () => ({
  default: ({ onSelectionChange }: { onSelectionChange?: (target: unknown) => void }) =>
    createElement(
      "button",
      {
        "data-testid": "ring-select",
        onClick: () => onSelectionChange?.({ type: "entry", entryId: "entry-9" }),
      },
      "ring",
    ),
}));
vi.mock("../components/Timeline.tsx", () => ({
  default: ({ highlight }: { highlight?: unknown }) =>
    createElement("div", { "data-testid": "list" }, JSON.stringify(highlight ?? null)),
}));
vi.mock("../lib/overnightDisplaySetting.ts", () => ({ getMergeOvernightEnabled: () => false }));

describe("TimelinePage 环面选中联动列表", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(TimelinePage)));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("环面选中透传为列表 highlight，切日期清空", async () => {
    expect(host.querySelector('[data-testid="list"]')?.textContent).toBe("null");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="ring-select"]')?.click();
    });
    expect(host.querySelector('[data-testid="list"]')?.textContent).toContain('"entryId":"entry-9"');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="prev-day"]')?.click();
    });
    expect(host.querySelector('[data-testid="list"]')?.textContent).toBe("null");
  });
});
