// @vitest-environment jsdom
import type { QuickNote } from "@timedata/shared";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NoteBubble from "./NoteBubble.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function note(text: string): QuickNote {
  return {
    id: "note-1",
    text,
    occurredAt: "2026-06-01T04:00:00.000Z",
    createdAt: "2026-06-01T04:00:00.000Z",
    updatedAt: "2026-06-01T04:00:00.000Z",
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(element: ReactElement): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  await flush();
  return { host, root };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NoteBubble", () => {
  it("does not show expand controls for short content", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);

    const { host, root } = await render(createElement(NoteBubble, { note: note("短文本") }));

    expect(host.textContent).toContain("短文本");
    expect(host.textContent).not.toContain("展开");

    await act(async () => root.unmount());
  });

  it("expands and collapses long content", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(220);
    const longText = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行`).join("\n");

    const { host, root } = await render(createElement(NoteBubble, { note: note(longText) }));
    const button = host.querySelector("button");

    expect(button?.textContent).toBe("展开");
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

    await act(async () => root.unmount());
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

    await act(async () => root.unmount());
  });
});
