// @vitest-environment jsdom
import type { TrackStep } from "@timedata/shared";
import { afterEach, describe, expect, it } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TrackTimeline } from "./TrackTimeline.js";

const NOW = new Date("2026-06-21T02:00:00.000Z");

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function makeSteps(count: number): TrackStep[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    trackId: "t1",
    source: "agent" as const,
    content: `第 ${i} 步`,
    startedAt: "2026-06-21T00:00:00.000Z",
    endedAt: "2026-06-21T00:30:00.000Z",
    refs: [],
    tags: [],
    seq: i,
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
  }));
}

describe("TrackTimeline", () => {
  it("shows all steps when under the fold threshold", async () => {
    mounted = await renderDom(<TrackTimeline steps={makeSteps(5)} now={NOW} />);
    expect(mounted.host.querySelectorAll("li").length).toBe(5);
    expect(mounted.host.textContent).not.toContain("显示其余");
  });

  it("folds the middle of a long timeline and expands on click", async () => {
    mounted = await renderDom(<TrackTimeline steps={makeSteps(30)} now={NOW} />);
    const host = mounted.host;
    expect(host.textContent).toContain("显示其余 15 步");
    // head 12 + 折叠按钮 1 + tail 3 = 16 个 li
    expect(host.querySelectorAll("li").length).toBe(16);
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("显示其余"));
    await click(button ?? null);
    expect(host.querySelectorAll("li").length).toBe(30);
    expect(host.textContent).not.toContain("显示其余");
  });
});
