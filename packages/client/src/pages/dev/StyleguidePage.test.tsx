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

  it("renders the input controls section with the four legacy components", () => {
    const html = renderToStaticMarkup(<MemoryRouter><StyleguidePage /></MemoryRouter>);
    expect(html).toContain("输入控件");
    // DateField / TimeField 是带弹层的控件，字段按钮本身即触发钮：
    // ariaLabel 由组件渲染进触发钮的 aria-label，删实例即丢失，锁的是组件本体而非标题文案。
    expect(html).toContain('aria-label="开始日期"');
    expect(html).toContain('aria-label="开始时间"');
    // MonthCalendar：锁月历本体渲染出的选中日按钮 aria-label（组件内部按 date 生成的文案）。
    expect(html).toContain('aria-label="2026-08-10"');
    // Checkbox：label 由组件自身渲染成可见文本，两态各一枚。
    expect(html).toContain("勾选态");
    expect(html).toContain("未勾选态");
  });
});
