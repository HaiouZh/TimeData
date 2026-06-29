// @vitest-environment jsdom
import { act, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "../test/domHarness.js";
import { renderDom, unmount } from "../test/domHarness.js";
import QuickNoteActionMenu from "./QuickNoteActionMenu.js";

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function menuItem(host: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(host.querySelectorAll('button[role="menuitem"]')).find(
    (button) => button.textContent === text,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`missing menu item ${text}`);
  return match;
}

async function render(props: QuickNoteActionMenuProps): Promise<{ host: HTMLElement; root: Root }> {
  const { host, root } = await renderDom(createElement(QuickNoteActionMenu, props));
  await flush();
  return { host, root };
}

type QuickNoteActionMenuProps = Parameters<typeof QuickNoteActionMenu>[0];

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("QuickNoteActionMenu", () => {
  it("calls the chosen action and closes", async () => {
    const onCopy = vi.fn();
    const onClose = vi.fn();
    const { host, root } = await render({
      x: 10,
      y: 10,
      onCopy,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onSelect: vi.fn(),
      onTogglePin: vi.fn(),
      pinned: false,
      onClose,
    });

    await act(async () => {
      menuItem(host, "复制").click();
    });
    await flush();

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await unmount(root);
  });

  it("uses design tokens for menu chrome", async () => {
    const { host, root } = await render({
      x: 10,
      y: 10,
      onCopy: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onSelect: vi.fn(),
      onTogglePin: vi.fn(),
      pinned: false,
      onClose: vi.fn(),
    });

    expect(host.innerHTML).toContain("border-border");
    expect(host.innerHTML).toContain("bg-surface-elevated");
    expect(host.innerHTML).toContain("text-danger");
    expect(host.innerHTML).not.toContain(["slate", ""].join("-"));
    expect(host.innerHTML).not.toContain(["text", "red", ""].join("-"));

    await unmount(root);
  });

  it("closes when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { host, root } = await render({
      x: 0,
      y: 0,
      onCopy: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onSelect: vi.fn(),
      onTogglePin: vi.fn(),
      pinned: false,
      onClose,
    });

    const backdrop = host.querySelector('[role="presentation"]');
    await act(async () => {
      (backdrop as HTMLElement).click();
    });
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);

    await unmount(root);
  });

  it("点击「选择」触发 onSelect 并关闭", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { host, root } = await render({
      x: 10,
      y: 10,
      onCopy: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onSelect,
      onTogglePin: vi.fn(),
      pinned: false,
      onClose,
    });

    await act(async () => {
      menuItem(host, "选择").click();
    });
    await flush();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await unmount(root);
  });

  it("未置顶显示「置顶」，已置顶显示「取消置顶」", async () => {
    const onTogglePin = vi.fn();
    const { host, root } = await render({
      x: 10,
      y: 10,
      onCopy: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onSelect: vi.fn(),
      onTogglePin,
      pinned: true,
      onClose: vi.fn(),
    });

    await act(async () => {
      menuItem(host, "取消置顶").click();
    });
    await flush();

    expect(onTogglePin).toHaveBeenCalledTimes(1);

    await unmount(root);
  });
});
