// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalSidePanel } from "./GoalSidePanel.js";

describe("GoalSidePanel", () => {
  it("open=false 时不渲染内容", async () => {
    const rendered = await renderDom(
      createElement(GoalSidePanel, { open: false, title: "添加成员", onClose: vi.fn() }, "内容"),
    );

    expect(rendered.host.textContent).not.toContain("内容");

    await unmount(rendered.root);
  });

  it("open=true 时渲染右侧面板和关闭按钮", async () => {
    const onClose = vi.fn();
    const rendered = await renderDom(
      createElement(GoalSidePanel, { open: true, title: "添加成员", onClose }, "内容"),
    );

    expect(rendered.host.querySelector('aside[aria-label="添加成员"]')?.textContent).toContain("内容");
    await click(rendered.host.querySelector('button[aria-label="关闭添加成员"]'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await unmount(rendered.root);
  });
});
