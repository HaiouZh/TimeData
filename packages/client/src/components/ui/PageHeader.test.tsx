// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { PageHeader } from "./PageHeader.js";

afterEach(async () => {});

describe("PageHeader", () => {
  it("渲染 title 与 sticky 容器类", async () => {
    const { host, root } = await renderDom(createElement(PageHeader, { title: "测试页" }));
    const header = host.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.className).toContain("sticky");
    expect(header?.className).toContain("bg-page/95");
    expect(header?.querySelector("h1")?.textContent).toBe("测试页");
    await unmount(root);
  });

  it("back / actions 注入到对应位置", async () => {
    const { host, root } = await renderDom(
      createElement(PageHeader, {
        title: "测试页",
        back: createElement("button", { type: "button", "aria-label": "返回" }),
        actions: createElement("button", { type: "button", "aria-label": "动作" }),
      }),
    );
    expect(host.querySelector('button[aria-label="返回"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="动作"]')).not.toBeNull();
    await unmount(root);
  });

  it("children 渲染在 title 行下方（第二行）", async () => {
    const { host, root } = await renderDom(
      createElement(
        PageHeader,
        { title: "测试页" },
        createElement("div", { "data-testid": "second-row" }, "第二行"),
      ),
    );
    const h1 = host.querySelector("h1");
    const second = host.querySelector('[data-testid="second-row"]');
    expect(second).not.toBeNull();
    expect(h1 && second && h1.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await unmount(root);
  });
});
