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

async function mount(
  tracks: Track[],
  stepsByTrack: Map<string, TrackStep[]>,
  selectedTrackId: string | null = null,
) {
  mounted = await renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: ["/tracks"] },
      createElement(TracksGanttPanel, { tracks, stepsByTrack, now: NOW, selectedTrackId }),
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

  it("右侧现状栏：每条泳道一格，进行中/停着分别有状态文案", async () => {
    const a = makeTrack("a");
    const b = makeTrack("b");
    const { host } = await mount(
      [a, b],
      new Map([["a", [makeStep("a", HOUR, null)]]]),
    );
    const cells = host.querySelectorAll('[data-testid="gantt-now-status"]');
    expect(cells).toHaveLength(2);
    const kinds = [...cells].map((c) => c.getAttribute("data-kind"));
    expect(kinds).toContain("running");
    expect(kinds).toContain("idle");
    expect(host.textContent).toContain("已1小时");
  });

  it("带等待信号的开口步画空心等待条，现状栏显示已等", async () => {
    const a = makeTrack("a");
    const wait = { ...makeStep("a", 5 * HOUR, null), tags: ["待我处理"] };
    const { host } = await mount([a], new Map([["a", [wait]]]));
    const seg = host.querySelector('[data-testid="gantt-seg"][data-waiting="true"]');
    expect(seg).not.toBeNull();
    expect(seg?.getAttribute("fill")).toBe("transparent");
    // 等待是持续状态：超2h也不画陈旧虚线尾迹
    expect(host.querySelector('[data-testid="gantt-stale-tail"]')).toBeNull();
    const status = host.querySelector('[data-testid="gantt-now-status"]');
    expect(status?.getAttribute("data-kind")).toBe("waiting");
    expect(status?.textContent).toContain("已等");
  });

  it("僵尸开口步画实头+虚线尾迹", async () => {
    const a = makeTrack("a");
    const { host } = await mount([a], new Map([["a", [makeStep("a", 72 * HOUR, null)]]]));
    expect(host.querySelector('[data-testid="gantt-stale-tail"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="gantt-seg"][data-kind="running"]')).not.toBeNull();
  });

  it("新鲜开口步无虚线尾迹", async () => {
    const a = makeTrack("a");
    const { host } = await mount([a], new Map([["a", [makeStep("a", HOUR, null)]]]));
    expect(host.querySelector('[data-testid="gantt-stale-tail"]')).toBeNull();
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

  it("新鲜开口步在 now 线画活头脉冲", async () => {
    const a = makeTrack("a");
    const { host } = await mount([a], new Map([["a", [makeStep("a", HOUR, null)]]]));
    expect(host.querySelector('[data-testid="gantt-live-head"]')).not.toBeNull();
  });

  it("僵尸开口步与等待步不画活头", async () => {
    const a = makeTrack("a");
    const b = makeTrack("b");
    const wait = { ...makeStep("b", HOUR, null), tags: ["待我处理"] };
    const { host } = await mount(
      [a, b],
      new Map([
        ["a", [makeStep("a", 72 * HOUR, null)]],
        ["b", [wait]],
      ]),
    );
    expect(host.querySelector('[data-testid="gantt-live-head"]')).toBeNull();
  });

  it("瞬时步画菱形标记，热区仍是 gantt-seg 可点", async () => {
    const a = makeTrack("a");
    const instant = makeStep("a", 3 * HOUR, 3 * HOUR); // startedAt == endedAt → point 段
    const { host } = await mount([a], new Map([["a", [instant]]]));
    expect(host.querySelector('[data-testid="gantt-diamond"]')).not.toBeNull();
    const hit = host.querySelector('[data-testid="gantt-seg"]');
    expect(hit?.tagName.toLowerCase()).toBe("circle");
    expect(hit?.getAttribute("fill")).toBe("transparent");
    await click(hit);
    expect(host.querySelector('[data-testid="location-probe"]')?.textContent).toContain(
      `/tracks/a#step-${instant.id}`,
    );
  });

  it("selectedTrackId 命中的泳道有高亮底色，现状栏名字转 accent", async () => {
    const a = makeTrack("a");
    const b = makeTrack("b");
    const { host } = await mount([a, b], new Map(), "b");
    expect(host.querySelectorAll('[data-testid="gantt-lane-active"]')).toHaveLength(1);
    const names = [...host.querySelectorAll('[data-testid="gantt-lane-name"]')];
    const selected = names.find((n) => n.getAttribute("title") === "轨道b");
    expect(selected?.className).toContain("text-accent");
  });

  it("未传 selectedTrackId 时无泳道高亮", async () => {
    const a = makeTrack("a");
    const { host } = await mount([a], new Map());
    expect(host.querySelector('[data-testid="gantt-lane-active"]')).toBeNull();
  });

  it("快捷档按钮存在：今天/3天/周/回到现在", async () => {
    const { host } = await mount([makeTrack("a")], new Map());
    for (const label of ["今天", "3天", "周", "回到现在"]) {
      expect(host.textContent).toContain(label);
    }
  });
});
