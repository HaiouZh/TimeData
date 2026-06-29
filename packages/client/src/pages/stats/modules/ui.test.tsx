import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MetricCard, SectionPanel } from "./ui.tsx";

describe("stats ui", () => {
  it("SectionPanel 渲染标题与 eyebrow", () => {
    const html = renderToStaticMarkup(
      createElement(SectionPanel, { title: "总览", eyebrow: "Period" }, createElement("p", null, "body")),
    );
    expect(html).toContain("总览");
    expect(html).toContain("Period");
    expect(html).toContain("body");
  });

  it("MetricCard 渲染 label/value/hint", () => {
    const html = renderToStaticMarkup(createElement(MetricCard, { label: "总时长", value: "3.0h", hint: "覆盖率" }));
    expect(html).toContain("总时长");
    expect(html).toContain("3.0h");
    expect(html).toContain("覆盖率");
  });

  it("MetricCard value 接 td-metric tabular 数字角色", () => {
    const html = renderToStaticMarkup(createElement(MetricCard, { label: "本周", value: "12.5h" }));
    expect(html).toContain("td-metric");
    expect(html).toContain("12.5h");
  });
});
