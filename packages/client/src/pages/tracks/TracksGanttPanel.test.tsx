// @vitest-environment jsdom
import type { Track, TrackStep } from "@timedata/shared";
import { act, createElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import TracksGanttPanel from "./TracksGanttPanel.js";

const NOW = new Date(2026, 6, 8, 12, 0, 0);
const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function makeTrack(id: string): Track {
  return { id, title: `轨道${id}`, status: "active", refs: [], createdAt: iso(240 * HOUR), updatedAt: iso(0) };
}

let seq = 0;
function makeStep(
  trackId: string,
  startAgo: number,
  endAgo: number | null,
  source: "user" | "agent" = "user",
): TrackStep {
  seq += 1;
  return {
    id: `s${seq}`,
    trackId,
    source,
    content: `步骤${seq}`,
    startedAt: iso(startAgo),
    endedAt: endAgo === null ? null : iso(endAgo),
    refs: [],
    tags: [],
    seq,
    createdAt: iso(startAgo),
    updatedAt: iso(startAgo),
  };
}

function LocationProbe() {
  const location = useLocation();
  return createElement("output", { "data-testid": "location-probe" }, `${location.pathname}${location.hash}`);
}

async function mount(tracks: Track[], stepsByTrack: Map<string, TrackStep[]>) {
  mounted = await renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: ["/tracks"] },
      createElement(TracksGanttPanel, { tracks, stepsByTrack, now: NOW }),
      createElement(LocationProbe),
    ),
  );
  return mounted;
}

describe("TracksGanttPanel", () => {
  it("每条 active 轨道占一条泳道，空轨道也占道", async () => {
    const a = makeTrack("a");
    const b = makeTrack("b");
    const { host } = await mount([a, b], new Map([["a", [makeStep("a", 2 * HOUR, null)]]]));
    expect(host.querySelectorAll('[data-testid="gantt-lane"]')).toHaveLength(2);
    expect(host.textContent).toContain("轨道b");
  });

  it("running 段带 data-kind=running；此刻线存在", async () => {
    const a = makeTrack("a");
    const { host } = await mount([a], new Map([["a", [makeStep("a", 2 * HOUR, null)]]]));
    expect(host.querySelector('[data-testid="gantt-seg"][data-kind="running"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="gantt-now-line"]')).not.toBeNull();
  });

  it("刚收尾的泳道画余晖", async () => {
    const a = makeTrack("a");
    const { host } = await mount([a], new Map([["a", [makeStep("a", 3 * HOUR, HOUR)]]]));
    expect(host.querySelector('[data-testid="gantt-afterglow"]')).not.toBeNull();
  });

  it("统计条显示 进行中/24h 活跃", async () => {
    const a = makeTrack("a");
    const b = makeTrack("b");
    const { host } = await mount(
      [a, b],
      new Map([
        ["a", [makeStep("a", 2 * HOUR, null)]],
        ["b", [makeStep("b", 5 * HOUR, 4 * HOUR)]],
      ]),
    );
    const stats = host.querySelector('[data-testid="gantt-stats"]');
    expect(stats?.textContent).toContain("进行中 1");
    expect(stats?.textContent).toContain("24h 活跃 2");
  });

  it("点击段跳转到 /tracks/:id#step-<stepId>", async () => {
    const a = makeTrack("a");
    const step = makeStep("a", 2 * HOUR, HOUR);
    const { host } = await mount([a], new Map([["a", [step]]]));
    const seg = host.querySelector('[data-testid="gantt-seg"]');
    expect(seg).not.toBeNull();
    await click(seg);
    expect(host.querySelector('[data-testid="location-probe"]')?.textContent).toBe(`/tracks/a#step-${step.id}`);
  });

  it("悬停段出浮层，含内容与执行者", async () => {
    const a = makeTrack("a");
    const step = makeStep("a", 2 * HOUR, HOUR, "agent");
    const { host } = await mount([a], new Map([["a", [step]]]));
    const seg = host.querySelector('[data-testid="gantt-seg"]');
    expect(seg).not.toBeNull();
    await act(async () => {
      seg?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const tooltip = host.querySelector('[data-testid="gantt-tooltip"]');
    expect(tooltip?.textContent).toContain(step.content);
    expect(tooltip?.textContent).toContain("agent");
  });

  it("快捷档按钮存在：今天/3天/周/回到现在", async () => {
    const { host } = await mount([makeTrack("a")], new Map());
    for (const label of ["今天", "3天", "周", "回到现在"]) {
      expect(host.textContent).toContain(label);
    }
  });
});
