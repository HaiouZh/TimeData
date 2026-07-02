// @vitest-environment jsdom
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "../test/domHarness.js";
import { renderDom, unmount } from "../test/domHarness.js";
import TimelinePage from "./TimelinePage.js";

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
  let host: HTMLElement;
  let root: Root;

  beforeEach(async () => {
    const rendered = await renderDom(createElement(MemoryRouter, null, createElement(TimelinePage)));
    host = rendered.host;
    root = rendered.root;
  });

  afterEach(async () => {
    await unmount(root);
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
