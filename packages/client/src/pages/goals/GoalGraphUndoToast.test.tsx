// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalGraphUndoToast } from "./GoalGraphUndoToast.js";

let mountedRoot: Awaited<ReturnType<typeof renderDom>>["root"] | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  if (mountedRoot) await unmount(mountedRoot);
  mountedRoot = null;
  vi.useRealTimers();
});

describe("GoalGraphUndoToast", () => {
  it("does not render while closed", async () => {
    const { host, root } = await renderDom(
      createElement(GoalGraphUndoToast, {
        open: false,
        message: "已移除前置关系",
        onDismiss: vi.fn(),
      }),
    );
    mountedRoot = root;

    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.textContent).not.toContain("已移除前置关系");
  });

  it("renders an undo action inside a status toast when open", async () => {
    const onAction = vi.fn();
    const { host, root } = await renderDom(
      createElement(GoalGraphUndoToast, {
        open: true,
        message: "已移除前置关系",
        actionLabel: "撤销",
        onAction,
        onDismiss: vi.fn(),
      }),
    );
    mountedRoot = root;

    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain("已移除前置关系");
    const button = host.querySelector("[data-goal-undo-action]");
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.textContent).toContain("撤销");

    await click(button);

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("dismisses itself after the configured duration", async () => {
    const onDismiss = vi.fn();
    const { root } = await renderDom(
      createElement(GoalGraphUndoToast, {
        open: true,
        message: "已删除连接",
        onDismiss,
        durationMs: 1200,
      }),
    );
    mountedRoot = root;

    await act(async () => {
      vi.advanceTimersByTime(1199);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("can be closed by owner state after undo action", async () => {
    const onAction = vi.fn();
    function StatefulToast() {
      const [open, setOpen] = useState(true);
      return createElement(GoalGraphUndoToast, {
        open,
        message: "已移除成员",
        actionLabel: "撤销",
        onAction: () => {
          onAction();
          setOpen(false);
        },
        onDismiss: vi.fn(),
      });
    }

    const { host, root } = await renderDom(createElement(StatefulToast));
    mountedRoot = root;

    await click(host.querySelector("[data-goal-undo-action]"));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
