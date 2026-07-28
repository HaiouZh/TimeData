// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import TodoStatsPage from "./TodoStatsPage.js";

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => undefined,
}));

vi.mock("../lib/statsLayoutSetting.ts", () => ({
  useStatsLayoutForKey: () => ({
    order: ["overview", "created", "completed", "age", "heatmap", "cycle", "rhythm", "dimension"],
    hidden: new Set(),
    visibleModulesInOrder: ["overview", "created", "completed", "age", "heatmap", "cycle", "rhythm", "dimension"],
    setLayout: vi.fn(),
    reset: vi.fn(),
  }),
}));

async function renderPage() {
  return renderDom(createElement(MemoryRouter, null, createElement(TodoStatsPage)));
}

describe("TodoStatsPage", () => {
  it("骨架渲染：标题 + 8 张占位卡全部出现", async () => {
    const { host, root } = await renderPage();

    expect(host.textContent).toContain("待办统计");
    for (const title of ["总览", "创建分布", "完成分布", "存活时长分布", "完成热力图", "周期指标", "节奏", "维度拆解"]) {
      expect(host.textContent).toContain(title);
    }

    await unmount(root);
  });
});
