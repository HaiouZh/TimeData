// @vitest-environment jsdom
import type { Task } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TagFilterBar } from "./TagFilterBar.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(tags: string[]): Task {
  return {
    id: "t", title: "x", done: false, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: null,
    subtasks: [], completedCount: 0, turn: null, turnAt: null, completedAt: null, tags, sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

async function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

describe("TagFilterBar", () => {
  it("列出所有 tag，无选中时不显示清除", async () => {
    const { host, root } = await render(
      createElement(TagFilterBar, {
        tasks: [task(["重构", "bug"]), task(["bug", "api"])],
        selected: [],
        onToggle: () => {},
        onClear: () => {},
      }),
    );
    expect(host.textContent).toContain("#bug");
    expect(host.textContent).toContain("#重构");
    expect(host.textContent).toContain("#api");
    expect(host.querySelector('[aria-label="清除筛选"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it("点击 tag 调 onToggle；有选中时显示清除并调 onClear", async () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();
    const { host, root } = await render(
      createElement(TagFilterBar, {
        tasks: [task(["bug"])],
        selected: ["bug"],
        onToggle,
        onClear,
      }),
    );
    await act(async () => (host.querySelector('[aria-label="筛选 bug"]') as HTMLElement).click());
    expect(onToggle).toHaveBeenCalledWith("bug");
    await act(async () => (host.querySelector('[aria-label="清除筛选"]') as HTMLElement).click());
    expect(onClear).toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
