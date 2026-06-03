import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AnomaliesSection from "./AnomaliesSection.tsx";
import { makeStatsProps } from "./testFixtures.ts";

describe("AnomaliesSection", () => {
  it("无记录时显示未记录日异常", () => {
    const html = renderToStaticMarkup(
      createElement(AnomaliesSection, makeStatsProps({ entries: [], baselineEntries: [] })),
    );
    expect(html).toContain("异常与空挡");
    expect(html).toContain("未记录日");
  });
});
