// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickNoteActionMenu from "./QuickNoteActionMenu.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function render(props: QuickNoteActionMenuProps): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(QuickNoteActionMenu, props));
  });
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
      onClose,
    });

    await act(async () => {
      menuItem(host, "复制").click();
    });
    await flush();

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("closes when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { host, root } = await render({
      x: 0,
      y: 0,
      onCopy: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onClose,
    });

    const backdrop = host.querySelector('[role="presentation"]');
    await act(async () => {
      (backdrop as HTMLElement).click();
    });
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
