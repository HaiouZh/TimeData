// @vitest-environment jsdom
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalGraphToolbar } from "./GoalGraphToolbar.js";

const coarsePointerMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../../lib/useIsCoarsePointer.js", () => ({ useIsCoarsePointer: coarsePointerMock }));

function toolbarProps() {
  return {
    summary: { ready: 3, blocked: 2, completed: 1 },
    onAddMember: vi.fn<() => void>(),
    onFitView: vi.fn<() => void>(),
    onBackToGalaxy: vi.fn<() => void>(),
    onOpenGoalMenu: vi.fn<() => void>(),
  };
}

describe("GoalGraphToolbar", () => {
  beforeEach(() => {
    coarsePointerMock.mockReturnValue(false);
  });

  it("shows graph summary and routes the three toolbar actions independently", async () => {
    const onAddMember = vi.fn<() => void>();
    const onFitView = vi.fn<() => void>();
    const onBackToGalaxy = vi.fn<() => void>();
    const onOpenGoalMenu = vi.fn<() => void>();

    const { host, root } = await renderDom(
      createElement(GoalGraphToolbar, {
        summary: { ready: 3, blocked: 2, completed: 1 },
        onAddMember,
        onFitView,
        onBackToGalaxy,
        onOpenGoalMenu,
      }),
    );

    expect(host.textContent).toContain("3 能推 · 2 等前置 · 1 完成");

    const buttons = [...host.querySelectorAll("button")];
    expect(buttons).toHaveLength(4);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "添加成员",
      "回到全图",
      "返回目标星图",
      "目标菜单",
    ]);

    await click(host.querySelector('button[aria-label="添加成员"]'));
    expect(onAddMember).toHaveBeenCalledTimes(1);
    expect(onFitView).not.toHaveBeenCalled();
    expect(onOpenGoalMenu).not.toHaveBeenCalled();

    await click(host.querySelector('button[aria-label="回到全图"]'));
    expect(onAddMember).toHaveBeenCalledTimes(1);
    expect(onFitView).toHaveBeenCalledTimes(1);
    expect(onBackToGalaxy).not.toHaveBeenCalled();
    expect(onOpenGoalMenu).not.toHaveBeenCalled();

    await click(host.querySelector('button[aria-label="返回目标星图"]'));
    expect(onAddMember).toHaveBeenCalledTimes(1);
    expect(onFitView).toHaveBeenCalledTimes(1);
    expect(onBackToGalaxy).toHaveBeenCalledTimes(1);
    expect(onOpenGoalMenu).not.toHaveBeenCalled();

    await click(host.querySelector('button[aria-label="目标菜单"]'));
    expect(onAddMember).toHaveBeenCalledTimes(1);
    expect(onFitView).toHaveBeenCalledTimes(1);
    expect(onBackToGalaxy).toHaveBeenCalledTimes(1);
    expect(onOpenGoalMenu).toHaveBeenCalledTimes(1);

    await unmount(root);
  });

  it("renders restore layout action when provided", async () => {
    const onRestoreLayout = vi.fn<() => void>();
    const { host, root } = await renderDom(
      createElement(GoalGraphToolbar, {
        summary: { ready: 1, blocked: 0, completed: 0 },
        onAddMember: vi.fn(),
        onFitView: vi.fn(),
        onBackToGalaxy: vi.fn(),
        onOpenGoalMenu: vi.fn(),
        onRestoreLayout,
      }),
    );

    await click(host.querySelector('button[aria-label="恢复自动布局"]'));

    expect(onRestoreLayout).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("uses a 44px target for coarse pointers", async () => {
    coarsePointerMock.mockReturnValue(true);
    const { host, root } = await renderDom(createElement(GoalGraphToolbar, toolbarProps()));

    const button = host.querySelector('button[aria-label="添加成员"]');
    expect(button?.className).toContain("h-11");
    expect(button?.className).toContain("w-11");
    expect(button?.parentElement?.className).toContain("gap-2");
    await unmount(root);
  });

  it("keeps compact targets for fine pointers", async () => {
    coarsePointerMock.mockReturnValue(false);
    const { host, root } = await renderDom(createElement(GoalGraphToolbar, toolbarProps()));

    const button = host.querySelector('button[aria-label="添加成员"]');
    expect(button?.className).toContain("h-8");
    expect(button?.className).toContain("w-8");
    expect(button?.parentElement?.className).toContain("gap-1");
    await unmount(root);
  });
});
