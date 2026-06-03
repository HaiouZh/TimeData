import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import OverviewSection from "./OverviewSection.tsx";
import { makeStatsProps } from "./testFixtures.ts";

describe("OverviewSection", () => {
  it("无数据时显示空状态", () => {
    const html = renderToStaticMarkup(createElement(OverviewSection, makeStatsProps({ entries: [] })));
    expect(html).toContain("暂无统计数据");
  });

  it("渲染总览标题", () => {
    const html = renderToStaticMarkup(createElement(OverviewSection, makeStatsProps({ entries: [] })));
    expect(html).toContain("总览");
  });
});
