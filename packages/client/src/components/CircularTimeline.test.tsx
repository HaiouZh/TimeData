import type { TimeEntry } from "@timedata/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TimeSlot } from "../lib/time.js";
import CircularTimeline, {
  chooseInitialSelection,
  clampSlotToDayMinutes,
  describeRingSegment,
} from "./CircularTimeline.js";

vi.mock("../hooks/useCategories.js", () => ({
  useCategories: () => ({
    getCategoryColor: (id: string) => (id === "cat-work" ? "#2563eb" : "#64748b"),
    getCategoryPath: (id: string) => (id === "cat-work" ? "工作/编程" : "未知"),
  }),
}));

function entry(id: string, startTime: string, endTime: string): TimeEntry {
  return {
    id,
    categoryId: "cat-work",
    startTime,
    endTime,
    note: null,
    createdAt: "2026-05-08T07:00:00",
    updatedAt: "2026-05-08T07:00:00",
  };
}

describe("CircularTimeline selection", () => {
  it("defaults to the last gap", () => {
    const work = entry("entry-1", "2026-05-08T07:00:00", "2026-05-08T07:30:00");
    const slots: TimeSlot[] = [
      { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T07:00:00", entry: null, displayMode: "default" },
      { startTime: work.startTime, endTime: work.endTime, entry: work, displayMode: "default" },
      { startTime: "2026-05-08T07:30:00", endTime: "2026-05-08T08:00:00", entry: null, displayMode: "default" },
    ];

    expect(chooseInitialSelection(slots)).toEqual({
      type: "gap",
      startTime: "2026-05-08T07:30:00",
      endTime: "2026-05-08T08:00:00",
    });
  });

  it("falls back to the last entry when there are no gaps", () => {
    const work = entry("entry-1", "2026-05-08T07:00:00", "2026-05-08T08:00:00");

    expect(
      chooseInitialSelection([
        { startTime: work.startTime, endTime: work.endTime, entry: work, displayMode: "default" },
      ]),
    ).toEqual({
      type: "entry",
      entry: work,
    });
  });

  it("clamps cross-day slots to the selected day minutes", () => {
    expect(clampSlotToDayMinutes("2026-05-08", "2026-05-07T23:30:00", "2026-05-08T06:00:00")).toEqual({
      start: 0,
      end: 360,
    });
    expect(clampSlotToDayMinutes("2026-05-08", "2026-05-08T23:30:00", "2026-05-09T00:00:00")).toEqual({
      start: 1410,
      end: 1440,
    });
  });

  it("clamps UTC ISO slots using the app local timezone", () => {
    expect(clampSlotToDayMinutes("2026-05-08", "2026-05-07T23:00:00.000Z", "2026-05-08T00:00:00.000Z")).toEqual({
      start: 420,
      end: 480,
    });
    expect(clampSlotToDayMinutes("2026-05-08", "2026-05-07T15:00:00.000Z", "2026-05-07T17:00:00.000Z")).toEqual({
      start: 0,
      end: 60,
    });
  });

  it("describes a closed ring segment with outer and inner arcs", () => {
    const path = describeRingSegment(0, 60);

    expect(path).toContain("A 104 104");
    expect(path).toContain("A 72 72");
    expect(path.trim().endsWith("Z")).toBe(true);
  });

  it("describes a full-day ring segment without collapsing to a single zero-length arc", () => {
    const path = describeRingSegment(0, 1440);

    expect(path).toContain("M");
    expect(path).toContain("A 104 104");
    expect(path).toContain("A 72 72");
    expect(path.match(/A 104 104/g)?.length).toBe(2);
    expect(path.match(/A 72 72/g)?.length).toBe(2);
  });

  it("renders the selected gap in the center by default", () => {
    const work = entry("entry-1", "2026-05-08T07:00:00", "2026-05-08T07:30:00");
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          { startTime: work.startTime, endTime: work.endTime, entry: work, displayMode: "default" },
          { startTime: "2026-05-08T07:30:00", endTime: "2026-05-08T08:00:00", entry: null, displayMode: "default" },
        ],
        onEntryOpen: () => {},
        onGapOpen: () => {},
      }),
    );

    expect(html).toContain("待记录");
    expect(html).toContain("30分钟");
    expect(html).toContain("07:30 - 08:00");
  });

  it("renders 12 inner numeric marks and selectable entry/gap ring blocks", () => {
    const work = entry("entry-1", "2026-05-08T07:00:00", "2026-05-08T07:30:00");
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T07:00:00", entry: null, displayMode: "default" },
          { startTime: work.startTime, endTime: work.endTime, entry: work, displayMode: "default" },
          { startTime: "2026-05-08T07:30:00", endTime: "2026-05-08T08:00:00", entry: null, displayMode: "default" },
        ],
        onEntryOpen: () => {},
        onGapOpen: () => {},
      }),
    );

    for (const label of ["0", "2", "4", "6", "8", "10", "12", "14", "16", "18", "20", "22"]) {
      expect(html).toContain(`>${label}</text>`);
    }
    expect(html).toContain('data-tick-placement="inner"');
    expect(html).toContain('data-segment-type="entry"');
    expect(html).toContain('data-segment-type="gap"');
    expect(html).toContain('data-ring-indicator="true"');
  });

  it("renders selectable segments as filled ring blocks", () => {
    const work = entry("entry-1", "2026-05-08T07:00:00", "2026-05-08T07:30:00");
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T07:00:00", entry: null, displayMode: "default" },
          { startTime: work.startTime, endTime: work.endTime, entry: work, displayMode: "default" },
        ],
        onEntryOpen: () => {},
        onGapOpen: () => {},
      }),
    );

    expect(html).toContain('data-segment-type="entry"');
    expect(html).toContain('data-segment-type="gap"');
    expect(html).toContain('fill="#2563eb"');
    expect(html).not.toContain('stroke-linecap="round"');
  });
});
