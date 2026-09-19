// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "../test/domHarness.js";
import { renderDom, unmount } from "../test/domHarness.js";
import TimelinePage from "./TimelinePage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// DateNav 是本文件唯一不 mock 的下游——这条用例钉的就是它在时间轴页的真实形态。
vi.mock("../lib/punch.ts", () => ({ punchNow: vi.fn() }));
vi.mock("../hooks/useEntries.ts", () => ({
  useEntries: () => ({ entries: [], previousEntry: null }),
  useEntryMutations: () => ({ deleteEntry: vi.fn() }),
}));
vi.mock("../components/SyncIndicator.tsx", () => ({ default: () => null }));
vi.mock("../components/CircularTimeline.tsx", () => ({
  default: () => createElement("div", { "data-testid": "ring" }, "ring"),
}));
vi.mock("../components/Timeline.tsx", () => ({ default: () => createElement("div", null, "list") }));
vi.mock("../lib/overnightDisplaySetting.ts", () => ({ getMergeOvernightEnabled: () => false }));

describe("TimelinePage 的切日箭头", () => {
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await unmount(root);
      root = null;
    }
  });

  it("窄屏照样留左右箭头：圆环豁免横滑，按钮才是手机上全屏可用的那条切日路径", async () => {
    const rendered = await renderDom(createElement(MemoryRouter, null, createElement(TimelinePage)));
    root = rendered.root;

    for (const label of ["前一天", "后一天"]) {
      const arrow = rendered.host.querySelector(`button[aria-label="${label}"]`);
      expect(arrow, `${label} 按钮应当渲染`).not.toBeNull();
      // 这里曾是 `hidden sm:inline-flex`，理由是「窄屏有横滑兜底」。可圆环带着
      // data-swipe-exempt，手机上占屏最大的那块恰恰滑不动，横滑的命中区只剩顶部窄带
      // 和圆环下方的列表。谁再想把箭头在窄屏藏回去，这条就红。
      expect(arrow?.className, `${label} 在窄屏不能被藏起来`).not.toContain("hidden");
    }
  });
});
