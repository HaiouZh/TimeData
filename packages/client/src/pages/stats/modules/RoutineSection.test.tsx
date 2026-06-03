import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import RoutineSection from "./RoutineSection.tsx";
import { makeStatsProps } from "./testFixtures.ts";

describe("RoutineSection", () => {
  it("未配置睡眠分类时引导去设置", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RoutineSection, makeStatsProps({ sleepCategoryId: null }))),
    );
    expect(html).toContain("设置睡眠分类后可查看作息分析");
    expect(html).toContain('href="/settings/insights"');
  });
});
