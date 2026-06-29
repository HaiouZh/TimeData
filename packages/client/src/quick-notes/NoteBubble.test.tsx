// @vitest-environment jsdom
import type { QuickNote } from "@timedata/shared";
import { act, createElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "../test/domHarness.js";
import { renderDom, unmount } from "../test/domHarness.js";
import NoteBubble from "./NoteBubble.js";

function note(text: string, overrides: Partial<QuickNote> = {}): QuickNote {
  return {
    id: "note-1",
    text,
    occurredAt: "2026-06-01T04:00:00.000Z",
    createdAt: "2026-06-01T04:00:00.000Z",
    updatedAt: "2026-06-01T04:00:00.000Z",
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(element: ReactElement): Promise<{ host: HTMLElement; root: Root }> {
  const result = await renderDom(element);
  await flush();
  return result;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NoteBubble", () => {
  it("renders a pending clock with the local time", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);

    const { host, root } = await render(createElement(NoteBubble, { note: note("待同步"), pending: true }));

    expect(host.textContent).toContain("12:00");
    expect(host.querySelector('[aria-label="待上传"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="已上传"]')).toBeNull();

    await unmount(root);
  });

  it("renders an uploaded check when the note is not pending", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);

    const { host, root } = await render(createElement(NoteBubble, { note: note("已同步"), pending: false }));

    expect(host.querySelector('[aria-label="已上传"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="待上传"]')).toBeNull();

    await unmount(root);
  });

  it("shows a source badge for agent notes using sourceLabel", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);

    const { host, root } = await render(
      createElement(NoteBubble, { note: note("周报已生成", { source: "agent", sourceLabel: "Hermes" }) }),
    );

    expect(host.textContent).toContain("Hermes");
    expect(host.textContent).toContain("周报已生成");

    await unmount(root);
  });

  it("uses the agent meta color branch for agent notes", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);

    const { host, root } = await render(createElement(NoteBubble, { note: note("Agent", { source: "agent" }) }));

    const meta = host.querySelector('[aria-label="已上传"]')?.closest("span");
    expect(meta?.className).toContain("text-accent-ink");

    await unmount(root);
  });

  it("falls back to a default badge label for agent notes", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);

    const { host, root } = await render(createElement(NoteBubble, { note: note("周报已生成", { source: "agent" }) }));

    expect(host.textContent).toContain("助手");

    await unmount(root);
  });

  it("renders no source badge for user and legacy notes", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);

    const { host, root } = await render(createElement(NoteBubble, { note: note("短文本") }));

    expect(host.textContent).not.toContain("助手");

    await unmount(root);
  });

  it("does not show expand controls for short content", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);

    const { host, root } = await render(createElement(NoteBubble, { note: note("短文本") }));

    expect(host.textContent).toContain("短文本");
    expect(host.textContent).not.toContain("展开");

    await unmount(root);
  });

  it("expands and collapses long content", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(220);
    const longText = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行`).join("\n");

    const { host, root } = await render(createElement(NoteBubble, { note: note(longText) }));
    const button = host.querySelector("button");

    expect(button?.textContent).toBe("展开");
    expect(button?.parentElement?.className).toContain("justify-between");
    expect(button?.parentElement?.querySelector('[aria-label="已上传"]')).not.toBeNull();
    expect(host.querySelectorAll('[aria-label="已上传"]')).toHaveLength(1);
    expect((host.querySelector(".overflow-hidden") as HTMLElement).style.maxHeight).toBe("168px");

    await act(async () => {
      button?.click();
    });
    await flush();

    expect(host.querySelector("button")?.textContent).toBe("收起");
    expect((host.querySelector(".overflow-hidden") as HTMLElement).style.maxHeight).toBe("");

    await act(async () => {
      host.querySelector("button")?.click();
    });
    await flush();

    expect(host.querySelector("button")?.textContent).toBe("展开");

    await unmount(root);
  });

  it("keeps the expand button out of the parent long-press path", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(220);
    const parentPointerDown = vi.fn();

    const { host, root } = await render(
      createElement("div", { onPointerDown: parentPointerDown }, createElement(NoteBubble, { note: note("长文本") })),
    );
    const button = host.querySelector("button");

    await act(async () => {
      button?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(parentPointerDown).not.toHaveBeenCalled();

    await unmount(root);
  });
});
