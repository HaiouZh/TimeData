// @vitest-environment jsdom
import type { TimeEntry } from "@timedata/shared";
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import type { TimeSlot } from "../lib/time.js";
import CircularTimeline, {
  chooseInitialSelection,
  clampSlotToDayMinutes,
  describeRingSegment,
  findSlotAtMinutes,
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
      { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T07:00:00", entry: null, kind: "gap", displayMode: "default" },
      { startTime: work.startTime, endTime: work.endTime, entry: work, kind: "entry", displayMode: "default" },
      { startTime: "2026-05-08T07:30:00", endTime: "2026-05-08T08:00:00", entry: null, kind: "gap", displayMode: "default" },
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
        { startTime: work.startTime, endTime: work.endTime, entry: work, kind: "entry", displayMode: "default" },
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
    expect(path).toContain("A 62 62");
    expect(path.trim().endsWith("Z")).toBe(true);
  });

  it("describes a full-day ring segment without collapsing to a single zero-length arc", () => {
    const path = describeRingSegment(0, 1440);

    expect(path).toContain("M");
    expect(path).toContain("A 104 104");
    expect(path).toContain("A 62 62");
    expect(path.match(/A 104 104/g)?.length).toBe(2);
    expect(path.match(/A 62 62/g)?.length).toBe(2);
  });

  it("renders the center as range / category / duration while clicking punches", () => {
    const work = entry("entry-1", "2026-05-08T07:00:00", "2026-05-08T07:30:00");
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          { startTime: work.startTime, endTime: work.endTime, entry: work, kind: "entry", displayMode: "default" },
          { startTime: "2026-05-08T07:30:00", endTime: "2026-05-08T08:00:00", entry: null, kind: "gap", displayMode: "default" },
        ],
      }),
    );

    // 中心点击触发打点，但显示恢复为选段的时间段 / 分类 / 时长
    expect(html).toContain('aria-label="打点（记录到现在）"');
    const rangeIdx = html.indexOf("07:30 - 08:00");
    const titleIdx = html.indexOf("待记录");
    const durationIdx = html.indexOf("30分钟");
    expect(rangeIdx).toBeGreaterThanOrEqual(0);
    expect(titleIdx).toBeGreaterThan(rangeIdx);
    expect(durationIdx).toBeGreaterThan(titleIdx);
  });

  it("calls onPunch when the center is clicked", async () => {
    const onPunch = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(CircularTimeline, {
          date: "2026-05-08",
          slots: [
            {
              startTime: "2026-05-08T00:00:00",
              endTime: "2026-05-08T07:00:00",
              entry: null,
              kind: "gap",
              displayMode: "default",
            },
          ],
          onPunch,
        }),
      );
    });

    const center = container.querySelector('button[aria-label="打点（记录到现在）"]') as HTMLButtonElement;
    await act(async () => {
      center.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPunch).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders selectable entry/gap ring blocks and indicator", () => {
    const work = entry("entry-1", "2026-05-08T07:00:00", "2026-05-08T07:30:00");
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T07:00:00", entry: null, kind: "gap", displayMode: "default" },
          { startTime: work.startTime, endTime: work.endTime, entry: work, kind: "entry", displayMode: "default" },
          { startTime: "2026-05-08T07:30:00", endTime: "2026-05-08T08:00:00", entry: null, kind: "gap", displayMode: "default" },
        ],
      }),
    );

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
          { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T07:00:00", entry: null, kind: "gap", displayMode: "default" },
          { startTime: work.startTime, endTime: work.endTime, entry: work, kind: "entry", displayMode: "default" },
        ],
      }),
    );

    expect(html).toContain('data-segment-type="entry"');
    expect(html).toContain('data-segment-type="gap"');
    expect(html).toContain('fill="#2563eb"');
    expect(html).not.toContain('stroke-linecap="round"');
  });

  it("renders gap slots with full opacity and the neutral token fill", () => {
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T07:00:00", entry: null, kind: "gap", displayMode: "default" },
        ],
      }),
    );

    expect(html).toMatch(/data-segment-type="gap"[^>]*opacity="1"/);
    expect(html).toMatch(/data-segment-type="gap"[^>]*fill="var\(--color-ink-3\)"/);
  });

  it("renders future slots with surface token fill and excludes them from selection", () => {
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          { startTime: "2026-05-08T03:00:00.000Z", endTime: "2026-05-08T16:00:00.000Z", entry: null, kind: "future", displayMode: "default" },
        ],
      }),
    );

    expect(html).toContain('data-segment-type="future"');
    expect(html).toMatch(/data-segment-type="future"[^>]*fill="var\(--color-surface\)"/);
  });

  it("dims non-selected segments while a selection exists", () => {
    const work = entry("entry-1", "2026-05-08T07:00:00", "2026-05-08T07:30:00");
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T07:00:00", entry: null, kind: "gap", displayMode: "default" },
          { startTime: work.startTime, endTime: work.endTime, entry: work, kind: "entry", displayMode: "default" },
          { startTime: "2026-05-08T07:30:00", endTime: "2026-05-08T08:00:00", entry: null, kind: "gap", displayMode: "default" },
        ],
      }),
    );

    // 末尾空档为初始选中（opacity 1），其余段被压暗
    expect(html).toContain('opacity="0.45"');
  });

  it("renders 24 hour numerals 0..23 and three tick tiers", () => {
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T07:00:00", entry: null, kind: "gap", displayMode: "default" },
        ],
      }),
    );

    for (let h = 0; h < 24; h++) {
      expect(html).toContain(`>${h}</text>`);
    }
    expect(html).toContain('data-tick-tier="hour"');
    expect(html).toContain('data-tick-tier="half"');
    expect(html).toContain('data-tick-tier="micro"');
  });

  it("switches selection when pointer drags across slots", async () => {
    const work = entry("entry-1", "2026-05-08T06:00:00", "2026-05-08T07:00:00");
    const handleSelectionChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(CircularTimeline, {
          date: "2026-05-08",
          slots: [
            { startTime: "2026-05-08T00:00:00", endTime: "2026-05-08T06:00:00", entry: null, kind: "gap", displayMode: "default" },
            { startTime: work.startTime, endTime: work.endTime, entry: work, kind: "entry", displayMode: "default" },
            { startTime: "2026-05-08T07:00:00", endTime: "2026-05-08T08:00:00", entry: null, kind: "gap", displayMode: "default" },
          ],
          onSelectionChange: handleSelectionChange,
        }),
      );
    });

    const svg = container.querySelector("svg");
    if (!svg) throw new Error("svg not found");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: 240,
      width: 240,
      height: 240,
      toJSON: () => ({}),
    } as DOMRect);

    Object.assign(svg, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    });

    await act(async () => {
      svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 205, clientY: 120, pointerId: 1 }));
    });
    // 选段同时驱动环面高亮与中心显示（分类 / 时长）
    expect(container.innerHTML).toContain('data-ring-indicator="true"');
    expect(container.innerHTML).toContain("工作/编程");
    expect(container.innerHTML).toContain("1小时");
    expect(handleSelectionChange).toHaveBeenCalledTimes(1);
    expect(handleSelectionChange).toHaveBeenLastCalledWith({ type: "entry", entryId: "entry-1" });

    await act(async () => {
      svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 120, clientY: 35, pointerId: 1 }));
    });
    expect(container.innerHTML).toContain("待记录");
    expect(container.innerHTML).toContain("00:00 - 06:00");
    expect(handleSelectionChange).toHaveBeenCalledTimes(2);
    expect(handleSelectionChange).toHaveBeenLastCalledWith({
      type: "gap",
      startTime: "2026-05-08T00:00:00",
      endTime: "2026-05-08T06:00:00",
    });

    await act(async () => {
      svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 120, clientY: 35, pointerId: 1 }));
    });
    expect(handleSelectionChange).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("CircularTimeline selection stability (TL-01)", () => {
  function makeSlots(): TimeSlot[] {
    const work = entry("entry-1", "2026-05-08T06:00:00", "2026-05-08T07:00:00");
    return [
      {
        startTime: "2026-05-08T00:00:00",
        endTime: "2026-05-08T06:00:00",
        entry: null,
        kind: "gap",
        displayMode: "default",
      },
      { startTime: work.startTime, endTime: work.endTime, entry: work, kind: "entry", displayMode: "default" },
      {
        startTime: "2026-05-08T07:00:00",
        endTime: "2026-05-08T08:00:00",
        entry: null,
        kind: "gap",
        displayMode: "default",
      },
    ];
  }

  const cloneSlots = (slots: TimeSlot[]): TimeSlot[] =>
    slots.map((slot) => ({ ...slot, entry: slot.entry ? { ...slot.entry } : null }));

  async function mountAndSelectMorningGap() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (slots: TimeSlot[]) =>
      act(async () => {
        root.render(createElement(CircularTimeline, { date: "2026-05-08", slots }));
      });

    await render(makeSlots());

    const svg = container.querySelector("svg");
    if (!svg) throw new Error("svg not found");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: 240,
      width: 240,
      height: 240,
      toJSON: () => ({}),
    } as DOMRect);
    Object.assign(svg, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    });

    await act(async () => {
      svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 120, clientY: 35, pointerId: 1 }));
      svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 120, clientY: 35, pointerId: 1 }));
    });

    expect(container.innerHTML).toContain("00:00 - 06:00");
    return { container, root, render };
  }

  it("等值新引用的 slots 重渲染不重置选中与箭头", async () => {
    const { container, root, render } = await mountAndSelectMorningGap();
    const arrowBefore = container.querySelector('[data-ring-indicator="true"]')?.getAttribute("points");

    await render(cloneSlots(makeSlots()));

    expect(container.innerHTML).toContain("00:00 - 06:00");
    expect(container.querySelector('[data-ring-indicator="true"]')?.getAttribute("points")).toBe(arrowBefore);
    await act(async () => root.unmount());
    container.remove();
  });

  it("选中的末尾空档随时间增长：中心时长跟随、箭头不动", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const grow = (endClock: string): TimeSlot[] => [
      {
        startTime: "2026-05-08T06:00:00",
        endTime: `2026-05-08T${endClock}`,
        entry: null,
        kind: "gap",
        displayMode: "default",
      },
    ];

    await act(async () => {
      root.render(createElement(CircularTimeline, { date: "2026-05-08", slots: grow("07:00:00") }));
    });
    expect(container.innerHTML).toContain("06:00 - 07:00");

    await act(async () => {
      root.render(createElement(CircularTimeline, { date: "2026-05-08", slots: grow("07:01:00") }));
    });
    expect(container.innerHTML).toContain("06:00 - 07:01");
    await act(async () => root.unmount());
    container.remove();
  });

  it("默认目标变化时回到默认选中", async () => {
    const { container, root, render } = await mountAndSelectMorningGap();
    const next = makeSlots();
    const late = entry("entry-2", "2026-05-08T08:00:00", "2026-05-08T09:00:00");
    next.push(
      { startTime: late.startTime, endTime: late.endTime, entry: late, kind: "entry", displayMode: "default" },
      {
        startTime: "2026-05-08T09:00:00",
        endTime: "2026-05-08T10:00:00",
        entry: null,
        kind: "gap",
        displayMode: "default",
      },
    );

    await render(next);

    expect(container.innerHTML).toContain("09:00 - 10:00");
    await act(async () => root.unmount());
    container.remove();
  });
});

describe("CircularTimeline selection callback (TL-08/TL-17)", () => {
  it("初始默认选中不触发 onSelectionChange", async () => {
    const handleSelectionChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(CircularTimeline, {
          date: "2026-05-08",
          slots: [
            {
              startTime: "2026-05-08T00:00:00",
              endTime: "2026-05-08T07:00:00",
              entry: null,
              kind: "gap",
              displayMode: "default",
            },
          ],
          onSelectionChange: handleSelectionChange,
        }),
      );
    });

    expect(handleSelectionChange).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    container.remove();
  });
});

describe("CircularTimeline touch dead zone (TL-06)", () => {
  it("svg 本体不再禁滚，环带 path 才带 touch-action:none", () => {
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-05-08",
        slots: [
          {
            startTime: "2026-05-08T00:00:00",
            endTime: "2026-05-08T07:00:00",
            entry: null,
            kind: "gap",
            displayMode: "default",
          },
        ],
      }),
    );
    const svgTag = html.slice(html.indexOf("<svg"), html.indexOf(">", html.indexOf("<svg")) + 1);

    expect(svgTag).not.toContain("touch-action");
    expect(html).toMatch(/<path[^>]*touch-action:\s*none/);
  });

  it("四角空白处 pointerdown 不捕获指针也不改选中", async () => {
    const work = entry("entry-1", "2026-05-08T06:00:00", "2026-05-08T07:00:00");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(CircularTimeline, {
          date: "2026-05-08",
          slots: [
            { startTime: work.startTime, endTime: work.endTime, entry: work, kind: "entry", displayMode: "default" },
            {
              startTime: "2026-05-08T07:00:00",
              endTime: "2026-05-08T08:00:00",
              entry: null,
              kind: "gap",
              displayMode: "default",
            },
          ],
        }),
      );
    });
    const svg = container.querySelector("svg");
    if (!svg) throw new Error("svg not found");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: 240,
      width: 240,
      height: 240,
      toJSON: () => ({}),
    } as DOMRect);
    const setPointerCapture = vi.fn();
    Object.assign(svg, { setPointerCapture, hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() });

    await act(async () => {
      svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 5, clientY: 5, pointerId: 1 }));
    });

    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain("07:00 - 08:00");
    await act(async () => root.unmount());
    container.remove();
  });
});

describe("findSlotAtMinutes minimum hit area (TL-07)", () => {
  const gapA: TimeSlot = {
    startTime: "2026-05-08T00:00:00",
    endTime: "2026-05-08T10:00:00",
    entry: null,
    kind: "gap",
    displayMode: "default",
  };
  const short = entry("entry-short", "2026-05-08T10:00:00", "2026-05-08T10:05:00");
  const shortSlot: TimeSlot = {
    startTime: short.startTime,
    endTime: short.endTime,
    entry: short,
    kind: "entry",
    displayMode: "default",
  };
  const gapB: TimeSlot = {
    startTime: "2026-05-08T10:05:00",
    endTime: "2026-05-08T20:00:00",
    entry: null,
    kind: "gap",
    displayMode: "default",
  };
  const slots = [gapA, shortSlot, gapB];

  it("5 分钟短段在扩展区内可命中", () => {
    expect(findSlotAtMinutes(slots, "2026-05-08", 599)).toBe(shortSlot);
    expect(findSlotAtMinutes(slots, "2026-05-08", 606)).toBe(shortSlot);
  });

  it("远离短段光环处仍归大段", () => {
    expect(findSlotAtMinutes(slots, "2026-05-08", 300)).toBe(gapA);
    expect(findSlotAtMinutes(slots, "2026-05-08", 900)).toBe(gapB);
  });

  it("相邻两个短段按中线分割", () => {
    const s1 = entry("entry-s1", "2026-05-08T10:00:00", "2026-05-08T10:04:00");
    const s2 = entry("entry-s2", "2026-05-08T10:04:00", "2026-05-08T10:08:00");
    const pair: TimeSlot[] = [
      { startTime: s1.startTime, endTime: s1.endTime, entry: s1, kind: "entry", displayMode: "default" },
      { startTime: s2.startTime, endTime: s2.endTime, entry: s2, kind: "entry", displayMode: "default" },
    ];

    expect(findSlotAtMinutes(pair, "2026-05-08", 603)?.entry?.id).toBe("entry-s1");
    expect(findSlotAtMinutes(pair, "2026-05-08", 605)?.entry?.id).toBe("entry-s2");
  });

  it("future 段依旧不可命中", () => {
    const futureSlot: TimeSlot = {
      startTime: "2026-05-08T20:00:00",
      endTime: "2026-05-09T00:00:00",
      entry: null,
      kind: "future",
      displayMode: "default",
    };

    expect(findSlotAtMinutes([futureSlot], "2026-05-08", 1300)).toBeNull();
  });
});

describe("CircularTimeline now indicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T10:00:00+08:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws a now indicator on today's view", () => {
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-06-03",
        slots: [
          { startTime: "2026-06-03T00:00:00", endTime: "2026-06-03T07:00:00", entry: null, kind: "gap", displayMode: "default" },
        ],
      }),
    );

    expect(html).toContain('data-now-indicator="true"');
  });

  it("hides the now indicator when viewing another day", () => {
    const html = renderToStaticMarkup(
      createElement(CircularTimeline, {
        date: "2026-06-02",
        slots: [
          { startTime: "2026-06-02T00:00:00", endTime: "2026-06-02T07:00:00", entry: null, kind: "gap", displayMode: "default" },
        ],
      }),
    );

    expect(html).not.toContain('data-now-indicator="true"');
  });
});
