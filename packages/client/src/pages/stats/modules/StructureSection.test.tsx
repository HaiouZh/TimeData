import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StructureSection from "./StructureSection.tsx";
import { makeStatsProps } from "./testFixtures.ts";

describe("StructureSection", () => {
  it("无足够会话时显示空状态", () => {
    const html = renderToStaticMarkup(
      createElement(StructureSection, makeStatsProps({ entries: [], baselineEntries: [] })),
    );
    expect(html).toContain("本周期无足够会话用于结构诊断。");
  });
});
