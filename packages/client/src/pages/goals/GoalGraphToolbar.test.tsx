// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalGraphToolbar } from "./GoalGraphToolbar.js";

describe("GoalGraphToolbar", () => {
  it("shows graph summary and routes the three toolbar actions independently", async () => {
    const onAddMember = vi.fn<() => void>();
    const onFitView = vi.fn<() => void>();
    const onOpenGoalMenu = vi.fn<() => void>();

    const { host, root } = await renderDom(
      createElement(GoalGraphToolbar, {
        summary: { ready: 3, blocked: 2, completed: 1 },
        onAddMember,
        onFitView,
        onOpenGoalMenu,
      }),
    );

    expect(host.textContent).toContain("3 能推 · 2 等前置 · 1 完成");

    const buttons = [...host.querySelectorAll("button")];
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["添加成员", "回到全图", "目标菜单"]);

    await click(host.querySelector('button[aria-label="添加成员"]'));
    expect(onAddMember).toHaveBeenCalledTimes(1);
    expect(onFitView).not.toHaveBeenCalled();
    expect(onOpenGoalMenu).not.toHaveBeenCalled();

    await click(host.querySelector('button[aria-label="回到全图"]'));
    expect(onAddMember).toHaveBeenCalledTimes(1);
    expect(onFitView).toHaveBeenCalledTimes(1);
    expect(onOpenGoalMenu).not.toHaveBeenCalled();

    await click(host.querySelector('button[aria-label="目标菜单"]'));
    expect(onAddMember).toHaveBeenCalledTimes(1);
    expect(onFitView).toHaveBeenCalledTimes(1);
    expect(onOpenGoalMenu).toHaveBeenCalledTimes(1);

    await unmount(root);
  });
});
