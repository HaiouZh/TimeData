import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import StyleguidePage from "./StyleguidePage.js";

describe("StyleguidePage", () => {
  it("renders token and typography sections", () => {
    const html = renderToStaticMarkup(<MemoryRouter><StyleguidePage /></MemoryRouter>);
    expect(html).toContain("设计语言预览");
    expect(html).toContain("--color-accent");
    expect(html).toContain("--color-track-agent");
    expect(html).not.toContain("--color-data-");
    expect(html).not.toContain("--z-sticky");
    expect(html).not.toContain("--color-warn-soft");
    expect(html).not.toContain("--color-danger-soft");
    expect(html).not.toContain("--duration-");
    expect(html).not.toContain("--ease-");
    // 带右括号避开子串假绿（"--color-tint-1" 是 "--color-tint-10" 的前缀，
    // 支数缩到 1 支时那条断言照样绿）。
    for (let i = 1; i <= 9; i++) expect(html).toContain(`--color-tint-${i})`);
    // 验收台是这些色值定稿的唯一依据（ADR 0026 决策一）：
    // 只断言 token 名时，把整个验收台 Section 删掉也不红——色块预览里还留着 token 名。
    expect(html).toContain("身份色的真实形态");
  });

  it("lists the typography and number role classes", () => {
    const html = renderToStaticMarkup(<MemoryRouter><StyleguidePage /></MemoryRouter>);
    expect(html).toContain("td-text-display");
    expect(html).toContain("td-num");
    expect(html).toContain("td-time");
    expect(html).toContain("td-duration");
  });

  it("renders the overlay system section with trigger buttons", () => {
    const html = renderToStaticMarkup(<MemoryRouter><StyleguidePage /></MemoryRouter>);
    expect(html).toContain("弹层体系");
    expect(html).toContain("打开 Sheet");
    expect(html).toContain("打开 ConfirmSheet（普通）");
    expect(html).toContain("打开 ConfirmSheet（danger）");
    // 锁 SelectSheet 组件实例本身：「演示强度」是传给组件的 label，由组件渲染进 trigger；
    // 断言说明 span 的「SelectSheet」字样会被删实例保留文案的变异逃逸（终审变异 D 实测）。
    expect(html).toContain("演示强度");
  });

  it("renders the feedback actions section", () => {
    const html = renderToStaticMarkup(<MemoryRouter><StyleguidePage /></MemoryRouter>);
    expect(html).toContain("反馈动作");
    expect(html).toContain("触发 ActionToast");
    expect(html).toContain("删除演示条目");
  });

  it("renders the page shell section with a sticky PageHeader demo", () => {
    const html = renderToStaticMarkup(<MemoryRouter><StyleguidePage /></MemoryRouter>);
    expect(html).toContain("页面壳");
    expect(html).toContain("演示页标题");
    expect(html).toContain("滚动这块区域看 sticky");
  });
});
