import type { Category, TimeEntry } from "@timedata/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import RoutineSection from "./RoutineSection.tsx";
import { makeStatsProps } from "./testFixtures.ts";

const sleepCategory: Category = {
  id: "sleep",
  name: "睡眠",
  parentId: null,
  color: "#808080",
  icon: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

// 8 晚：本地 23:00 入睡，次日本地 07:00 ±90min 起床 → maxSpread=90，落中间档。
function moderateNights(): TimeEntry[] {
  return [-90, -90, -90, -90, 90, 90, 90, 90].map((offset, index) => {
    const day = String(7 + index).padStart(2, "0");
    return {
      id: `s${index}`,
      categoryId: "sleep",
      startTime: `2026-05-${day}T15:00:00.000Z`,
      endTime: new Date(Date.parse(`2026-05-${day}T23:00:00.000Z`) + offset * 60000).toISOString(),
      note: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
  });
}

describe("RoutineSection", () => {
  it("未配置睡眠分类时引导去设置", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(RoutineSection, makeStatsProps({ sleepCategoryId: null }))),
    );
    expect(html).toContain("设置睡眠分类后可查看作息分析");
    expect(html).toContain('href="/settings/insights"');
  });

  it("中间档渲染自己的文案，不落回旧的兜底分支", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(
          RoutineSection,
          makeStatsProps({
            sleepCategoryId: "sleep",
            categories: [sleepCategory],
            entries: moderateNights(),
            effectiveRange: {
              fromDate: "2026-05-08",
              toDate: "2026-05-15",
              startUtc: "2026-05-07T16:00:00.000Z",
              endUtc: "2026-05-15T16:00:00.000Z",
            },
          }),
        ),
      ),
    );
    expect(html).toContain("作息规律一般");
    expect(html).not.toContain("未配置睡眠分类");
    expect(html).not.toContain("作息波动较大");
  });
});
