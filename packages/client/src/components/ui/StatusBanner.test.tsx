// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { StatusBanner } from "./StatusBanner.js";

afterEach(() => vi.restoreAllMocks());

describe("StatusBanner", () => {
  it("info tone 类名", async () => {
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "info" }, "提示"));
    const el = host.querySelector("div");
    expect(el?.className).toContain("rounded-card");
    expect(el?.className).toContain("border-border");
    expect(el?.className).toContain("bg-surface/95");
    expect(el?.className).toContain("text-ink-2");
    await unmount(root);
  });

  it("warn tone 类名", async () => {
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "warn" }, "警告"));
    const el = host.querySelector("div");
    expect(el?.className).toContain("border-warn/40");
    expect(el?.className).toContain("bg-warn/10");
    expect(el?.className).toContain("text-warn");
    await unmount(root);
  });

  it("danger tone 类名", async () => {
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "danger" }, "错误"));
    const el = host.querySelector("div");
    expect(el?.className).toContain("border-danger/40");
    expect(el?.className).toContain("bg-danger/10");
    expect(el?.className).toContain("text-danger");
    await unmount(root);
  });

  it("children 渲染", async () => {
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "info" }, "同步失败"));
    expect(host.textContent).toContain("同步失败");
    await unmount(root);
  });

  it("ok 档：成功态的边框/底色/文字色", async () => {
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "ok" }, "已生成"));
    const el = host.querySelector("[data-tone='ok']");
    expect(el?.className).toContain("border-ok/40");
    expect(el?.className).toContain("bg-ok/10");
    expect(el?.className).toContain("text-ok");
    await unmount(root);
  });

  it("bar 形态：贴边横条，无圆角卡片类", async () => {
    const { host, root } = await renderDom(
      createElement(StatusBanner, { tone: "danger", variant: "bar" }, "日记已被其他窗口修改"),
    );
    const el = host.querySelector("[data-tone='danger']");
    expect(el?.className).toContain("border-b");
    // 贴边横条不能有圆角卡片形态，否则日记页顶部会冒出一个悬空的圆角块。
    expect(el?.className).not.toContain("rounded-card");
    await unmount(root);
  });

  it("有 actions 时文字与动作并排", async () => {
    const { host, root } = await renderDom(
      createElement(
        StatusBanner,
        { tone: "danger", actions: createElement("button", { type: "button" }, "刷新重载") },
        "冲突了",
      ),
    );
    const banner = host.querySelector("[data-tone='danger']");
    expect(banner?.querySelector("button")?.textContent).toBe("刷新重载");
    expect(banner?.textContent).toContain("冲突了");
    await unmount(root);
  });

  it("没有 actions 时不套 flex 布局", async () => {
    // 18 处纯文字条不带 actions，多套一层 flex 会改变它们的 DOM 与换行行为。
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "info" }, "同步中"));
    expect(host.querySelector("[data-tone='info'] div")).toBeNull();
    await unmount(root);
  });

  it("className 与 role 透传；不传 role 时不渲染 role 属性", async () => {
    const withRole = await renderDom(
      createElement(StatusBanner, { tone: "danger", className: "fixed left-4", role: "alert" }, "出错了"),
    );
    const el = withRole.host.querySelector("[data-tone='danger']");
    expect(el?.className).toContain("fixed left-4");
    expect(el?.getAttribute("role")).toBe("alert");
    await unmount(withRole.root);

    // 现有 18 处都没有 role，无条件加会改变屏幕阅读器的播报行为。
    const plain = await renderDom(createElement(StatusBanner, { tone: "info" }, "提示"));
    expect(plain.host.querySelector("[data-tone='info']")?.hasAttribute("role")).toBe(false);
    await unmount(plain.root);
  });

  it("data-* 透传，且不得覆盖 data-tone", async () => {
    // 既有页面拿 data-* 当测试钩子（GoalGraphEditor.test 靠 data-connect-sheet-error 取节点），
    // 不透传就只能改那条测试来迁就实现——那是放水。
    const { host, root } = await renderDom(
      createElement(
        StatusBanner,
        { tone: "danger", "data-connect-sheet-error": "", "data-tone": "info" },
        "连线失败",
      ),
    );
    const el = host.querySelector("[data-connect-sheet-error]");
    expect(el).toBeInstanceOf(HTMLElement);
    // data-tone 是 19 处迁移断言的落点，调用方传什么都不能把它顶掉。
    expect(el?.getAttribute("data-tone")).toBe("danger");
    await unmount(root);
  });

  it("style 透传——速记两条浮条的 bottom 靠它算", async () => {
    // 这两条的定位是 `--bottom-offset` 自定义属性 + calc(…+var(--safe-bottom))，
    // 值随键盘/底栏实时变，只能走内联 style；组件不透传就等于把它们的定位丢了。
    const { host, root } = await renderDom(
      createElement(
        StatusBanner,
        { tone: "danger", style: { bottom: "calc(56px + var(--safe-bottom))" } },
        "出错了",
      ),
    );
    expect(host.querySelector<HTMLElement>("[data-tone='danger']")?.style.bottom).toBe(
      "calc(56px + var(--safe-bottom))",
    );
    await unmount(root);
  });
});
