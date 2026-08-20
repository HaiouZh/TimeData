// @vitest-environment jsdom

import type { TrackMilestone } from "@timedata/shared";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../../test/domHarness.js";
import { SegmentProgressBar } from "./SegmentProgressBar.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function milestone(
  partial: Partial<TrackMilestone> & { id: string; status: TrackMilestone["status"] },
): TrackMilestone {
  return {
    trackId: "track-1",
    title: "段",
    note: null,
    taskId: null,
    position: 0,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    ...partial,
  };
}

async function mount(milestones: readonly TrackMilestone[], size?: "full" | "mini") {
  mounted = await renderDom(createElement(SegmentProgressBar, { milestones, size }));
  return mounted.host;
}

describe("SegmentProgressBar", () => {
  it("① 三段全 pending → 3 空心格 + 0/3", async () => {
    const ms: TrackMilestone[] = [
      milestone({ id: "a", status: "pending", position: 0 }),
      milestone({ id: "b", status: "pending", position: 1 }),
      milestone({ id: "c", status: "pending", position: 2 }),
    ];
    const host = await mount(ms);
    const segments = host.querySelectorAll('[data-testid="segment"]');
    expect(segments.length).toBe(3);
    // pending 为空心边框，done 为实心，检查 class 区分
    for (const el of segments) {
      expect(el.getAttribute("data-status")).toBe("pending");
      expect((el as HTMLElement).className).toContain("border");
    }
    expect(host.textContent).toContain("0/3");
    expect(host.querySelector('[data-testid="segment-progress-text"]')?.textContent).toBe("0/3");
  });

  it("② 2 done 1 pending → 2 实心 + 3 格 + 2/3", async () => {
    const ms: TrackMilestone[] = [
      milestone({ id: "a", status: "done", position: 0 }),
      milestone({ id: "b", status: "done", position: 1 }),
      milestone({ id: "c", status: "pending", position: 2 }),
    ];
    const host = await mount(ms);
    const segments = host.querySelectorAll('[data-testid="segment"]');
    expect(segments.length).toBe(3);
    const done = [...segments].filter((el) => el.getAttribute("data-status") === "done");
    const pending = [...segments].filter((el) => el.getAttribute("data-status") === "pending");
    expect(done.length).toBe(2);
    expect(pending.length).toBe(1);
    // done 实心 accent，无 border
    for (const el of done) {
      expect((el as HTMLElement).className).toContain("bg-accent");
      expect((el as HTMLElement).className).not.toMatch(/border-accent.*bg-transparent/);
    }
    expect(host.textContent).toContain("2/3");
  });

  it("③ 含 1 dropped（3 段其一）→ 2 格 + 分母 2", async () => {
    const ms: TrackMilestone[] = [
      milestone({ id: "a", status: "done", position: 0 }),
      milestone({ id: "b", status: "pending", position: 1 }),
      milestone({ id: "c", status: "dropped", position: 2 }),
    ];
    const host = await mount(ms);
    const segments = host.querySelectorAll('[data-testid="segment"]');
    // dropped 不渲染格子
    expect(segments.length).toBe(2);
    expect(host.textContent).toContain("1/2");
    expect(host.textContent).not.toContain("1/3");
    expect(host.textContent).not.toContain("3");
  });

  it("④ 空列表 → 「未立骨架」出现且不出现 0/0", async () => {
    const host = await mount([]);
    expect(host.textContent).toContain("未立骨架");
    expect(host.textContent).not.toContain("0/0");
    expect(host.querySelector('[data-testid="segment-empty-line"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="segment"]').length).toBe(0);
  });

  it("⑤ 全 dropped → 同④ 未立骨架且无 0/0", async () => {
    const ms: TrackMilestone[] = [
      milestone({ id: "a", status: "dropped", position: 0 }),
      milestone({ id: "b", status: "dropped", position: 1 }),
    ];
    const host = await mount(ms);
    expect(host.textContent).toContain("未立骨架");
    expect(host.textContent).not.toContain("0/0");
    expect(host.querySelector('[data-testid="segment-empty-line"]')).not.toBeNull();
  });

  it("mini 档 total===0 只渲染短横线不带字且无 0/0", async () => {
    const host = await mount([], "mini");
    expect(host.querySelector('[data-testid="segment-empty-line"]')).not.toBeNull();
    expect(host.textContent).not.toContain("未立骨架");
    expect(host.textContent).not.toContain("0/0");
  });

  it("mini 档格子高度减半且数字更小", async () => {
    const ms: TrackMilestone[] = [
      milestone({ id: "a", status: "done", position: 0 }),
      milestone({ id: "b", status: "pending", position: 1 }),
    ];
    const hostFull = await mount(ms, "full");
    const fullClasses = [...hostFull.querySelectorAll('[data-testid="segment"]')]
      .map((el) => (el as HTMLElement).className)
      .join(" ");
    await unmount(mounted!.root);
    mounted = null;
    const hostMini = await mount(ms, "mini");
    const miniClasses = [...hostMini.querySelectorAll('[data-testid="segment"]')]
      .map((el) => (el as HTMLElement).className)
      .join(" ");
    // full 用 h-2，mini 用 h-1
    expect(fullClasses).toContain("h-2");
    expect(miniClasses).toContain("h-1");
    expect(miniClasses).not.toContain("h-2");
    // mini 数字更小：包含 text-xs
    expect(hostMini.querySelector('[data-testid="segment-progress-text"]')?.className).toContain("text-xs");
  });
});
