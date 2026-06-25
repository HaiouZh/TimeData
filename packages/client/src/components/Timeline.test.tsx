import type { TimeEntry } from "@timedata/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TimeSlot } from "../lib/time.js";
import Timeline from "./Timeline.js";

vi.mock("../hooks/useCategories.js", () => ({
  useCategories: () => ({
    getCategoryPath: () => "工作",
    getCategoryColor: () => "#2563eb",
  }),
}));

function entry(id: string, startTime: string, endTime: string): TimeEntry {
  return {
    id,
    categoryId: "cat-work",
    startTime,
    endTime,
    note: null,
    createdAt: "2026-05-08T07:00:00.000Z",
    updatedAt: "2026-05-08T07:00:00.000Z",
  };
}

describe("Timeline", () => {
  it("renders supplied slots", () => {
    const slots: TimeSlot[] = [
      {
        startTime: "2026-05-08T07:00:00",
        endTime: "2026-05-08T07:30:00",
        entry: entry("entry-1", "2026-05-08T07:00:00", "2026-05-08T07:30:00"),
        kind: "entry",
        displayMode: "default",
      },
      {
        startTime: "2026-05-08T07:30:00",
        endTime: "2026-05-08T08:00:00",
        entry: null,
        kind: "gap",
        displayMode: "default",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        slots,
        onGapClick: () => {},
        onEntryClick: () => {},
      }),
    );

    expect(html).toContain("07:30 - 08:00");
  });

  it("does not render future slots", () => {
    const slots: TimeSlot[] = [
      {
        startTime: "2026-05-08T03:00:00.000Z",
        endTime: "2026-05-08T16:00:00.000Z",
        entry: null,
        kind: "future",
        displayMode: "default",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(Timeline, { slots, onGapClick: () => {}, onEntryClick: () => {} }),
    );

    expect(html).toContain("今天还没有记录");
  });

  it("hides the short terminal gap before the future segment", () => {
    const slots: TimeSlot[] = [
      {
        startTime: "2026-05-08T07:00:00.000Z",
        endTime: "2026-05-08T07:30:00.000Z",
        entry: entry("entry-1", "2026-05-08T07:00:00.000Z", "2026-05-08T07:30:00.000Z"),
        kind: "entry",
        displayMode: "default",
      },
      {
        startTime: "2026-05-08T07:30:00.000Z",
        endTime: "2026-05-08T07:31:30.000Z",
        entry: null,
        kind: "gap",
        displayMode: "default",
      },
      {
        startTime: "2026-05-08T07:31:30.000Z",
        endTime: "2026-05-08T16:00:00.000Z",
        entry: null,
        kind: "future",
        displayMode: "default",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(Timeline, { slots, onGapClick: () => {}, onEntryClick: () => {} }),
    );

    expect(html).toContain("工作");
    expect(html).not.toContain("15:30 - 15:31");
    expect(html).not.toContain("补记这段");
  });

  it("keeps two-minute terminal gaps visible", () => {
    const slots: TimeSlot[] = [
      {
        startTime: "2026-05-08T07:00:00.000Z",
        endTime: "2026-05-08T07:30:00.000Z",
        entry: entry("entry-1", "2026-05-08T07:00:00.000Z", "2026-05-08T07:30:00.000Z"),
        kind: "entry",
        displayMode: "default",
      },
      {
        startTime: "2026-05-08T07:30:00.000Z",
        endTime: "2026-05-08T07:32:00.000Z",
        entry: null,
        kind: "gap",
        displayMode: "default",
      },
      {
        startTime: "2026-05-08T07:32:00.000Z",
        endTime: "2026-05-08T16:00:00.000Z",
        entry: null,
        kind: "future",
        displayMode: "default",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(Timeline, { slots, onGapClick: () => {}, onEntryClick: () => {} }),
    );

    expect(html).toContain("15:30 - 15:32");
    expect(html).toContain("补记这段");
  });

  it("keeps short gaps visible when they are between records", () => {
    const slots: TimeSlot[] = [
      {
        startTime: "2026-05-08T07:00:00.000Z",
        endTime: "2026-05-08T07:30:00.000Z",
        entry: entry("entry-1", "2026-05-08T07:00:00.000Z", "2026-05-08T07:30:00.000Z"),
        kind: "entry",
        displayMode: "default",
      },
      {
        startTime: "2026-05-08T07:30:00.000Z",
        endTime: "2026-05-08T07:31:30.000Z",
        entry: null,
        kind: "gap",
        displayMode: "default",
      },
      {
        startTime: "2026-05-08T07:31:30.000Z",
        endTime: "2026-05-08T08:00:00.000Z",
        entry: entry("entry-2", "2026-05-08T07:31:30.000Z", "2026-05-08T08:00:00.000Z"),
        kind: "entry",
        displayMode: "default",
      },
    ];
    const html = renderToStaticMarkup(
      createElement(Timeline, { slots, onGapClick: () => {}, onEntryClick: () => {} }),
    );

    expect(html).toContain("15:30 - 15:31");
    expect(html).toContain("补记这段");
  });
});
