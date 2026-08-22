// @vitest-environment jsdom
import type { TrackMilestone } from "@timedata/shared";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../../test/domHarness.js";
import { MilestoneBar } from "./MilestoneBar.js";

afterEach(() => vi.restoreAllMocks());

function milestone(id: string, status: TrackMilestone["status"], position = 0): TrackMilestone {
  return {
    id,
    trackId: "t1",
    title: id,
    status,
    note: null,
    taskId: null,
    position,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("MilestoneBar", () => {
  it("无段时展开按钮文案是「立骨架」", async () => {
    const { host, root } = await renderDom(
      createElement(MilestoneBar, { milestones: [], expanded: false, onToggle: () => {} }),
    );
    const toggle = host.querySelector("[data-testid='milestone-bar-toggle']");
    expect(toggle?.textContent).toContain("立骨架");
    expect(host.textContent).not.toContain("阶段");
    await unmount(root);
  });

  it("有段时展开按钮文案是「阶段」，并渲染分段条", async () => {
    const { host, root } = await renderDom(
      createElement(MilestoneBar, {
        milestones: [milestone("a", "done", 0), milestone("b", "pending", 1)],
        expanded: false,
        onToggle: () => {},
      }),
    );
    const toggle = host.querySelector("[data-testid='milestone-bar-toggle']");
    expect(toggle?.textContent).toContain("阶段");
    expect(host.querySelector("[data-testid='segment-progress-bar']")).not.toBeNull();
    await unmount(root);
  });

  it("点展开按钮触发 onToggle", async () => {
    const onToggle = vi.fn();
    const { host, root } = await renderDom(
      createElement(MilestoneBar, { milestones: [], expanded: false, onToggle }),
    );
    await click(host.querySelector("[data-testid='milestone-bar-toggle']"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("readOnly 且无段时不渲染展开按钮", async () => {
    const { host, root } = await renderDom(
      createElement(MilestoneBar, { milestones: [], expanded: false, onToggle: () => {}, readOnly: true }),
    );
    expect(host.querySelector("[data-testid='milestone-bar-toggle']")).toBeNull();
    await unmount(root);
  });

  // 归档轨道只读但仍有段——入口必须留着，否则已归档轨道的阶段骨架就再也看不到了。
  it("readOnly 但有段时展开按钮仍在", async () => {
    const { host, root } = await renderDom(
      createElement(MilestoneBar, {
        milestones: [milestone("a", "done", 0)],
        expanded: false,
        onToggle: () => {},
        readOnly: true,
      }),
    );
    expect(host.querySelector("[data-testid='milestone-bar-toggle']")).not.toBeNull();
    await unmount(root);
  });
});
