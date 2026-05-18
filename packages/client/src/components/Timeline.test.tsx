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
        displayMode: "default",
      },
      {
        startTime: "2026-05-08T07:30:00",
        endTime: "2026-05-08T08:00:00",
        entry: null,
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
});
