// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, pressKey, renderDom, unmount } from "../../test/domHarness.js";
import { Sheet } from "./Sheet.js";

afterEach(() => vi.restoreAllMocks());

describe("Sheet", () => {
  it("open=false 不渲染", async () => {
    const { host, root } = await renderDom(
      createElement(Sheet, { open: false, onClose: () => {}, title: "标题" }, "内容"),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await unmount(root);
  });

  it("open=true 渲染 children + role=dialog + aria-label=title", async () => {
    const { host, root } = await renderDom(
      createElement(Sheet, { open: true, onClose: () => {}, title: "选择分类" }, "正文"),
    );
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-label")).toBe("选择分类");
    expect(host.textContent).toContain("正文");
    await unmount(root);
  });

  it("点遮罩 / Esc / 关闭按钮都触发 onClose", async () => {
    for (const trigger of ["overlay", "esc", "button"] as const) {
      const onClose = vi.fn();
      const { host, root } = await renderDom(
        createElement(Sheet, { open: true, onClose, title: "T" }, "x"),
      );
      if (trigger === "overlay") await click(host.firstElementChild);
      else if (trigger === "esc") await pressKey("Escape");
      else await click(host.querySelector('button[aria-label="关闭"]'));
      expect(onClose).toHaveBeenCalledTimes(1);
      await unmount(root);
    }
  });
});
