// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, pressKey, renderDom, unmount } from "../../test/domHarness.js";
import { Sheet } from "./Sheet.js";

afterEach(() => vi.restoreAllMocks());

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

function overlay(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(".sheet-overlay");
}

describe("Sheet", () => {
  it("open=false 不渲染", async () => {
    const { host, root } = await renderDom(
      createElement(Sheet, { open: false, onClose: () => {}, title: "标题" }, "内容"),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(dialog()).toBeNull();
    await unmount(root);
  });

  it("open=true 渲染 children + role=dialog + aria-label=title", async () => {
    const { host, root } = await renderDom(
      createElement(Sheet, { open: true, onClose: () => {}, title: "选择分类" }, "正文"),
    );
    const localDialog = host.querySelector('[role="dialog"]');
    expect(localDialog?.getAttribute("aria-modal")).toBe("true");
    expect(localDialog?.getAttribute("aria-label")).toBe("选择分类");
    expect(host.textContent).toContain("正文");
    await unmount(root);
  });

  it("portal=true 时不受带 transform 的父容器定位影响", async () => {
    const { host, root } = await renderDom(
      createElement(
        "div",
        { style: { transform: "translateX(-50%)" }, "data-testid": "transformed-parent" },
        createElement(Sheet, { open: true, onClose: () => {}, title: "选择日期", portal: true }, "正文"),
      ),
    );

    const parent = host.querySelector('[data-testid="transformed-parent"]');
    expect(parent?.querySelector('[role="dialog"]')).toBeNull();
    expect(dialog()?.getAttribute("aria-label")).toBe("选择日期");
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

  it("z 设置遮罩层级；不传默认 50", async () => {
    const a = await renderDom(createElement(Sheet, { open: true, onClose: () => {}, title: "T", z: 65 }, "x"));
    expect((a.host.firstElementChild as HTMLElement).style.zIndex).toBe("65");
    await unmount(a.root);

    const b = await renderDom(createElement(Sheet, { open: true, onClose: () => {}, title: "T" }, "x"));
    expect((b.host.firstElementChild as HTMLElement).style.zIndex).toBe("50");
    await unmount(b.root);
  });
});
