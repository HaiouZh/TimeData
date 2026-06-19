// @vitest-environment jsdom
import type { Task } from "@timedata/shared";
import { describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TagFilterBar } from "./TagFilterBar.js";

function task(tags: string[]): Task {
  return {
    id: "t", title: "x", done: false, recurrence: null, lastDoneAt: null, startAt: null, scheduledAt: null,
    completedCount: 0, turn: null, turnAt: null, completedAt: null, tags, sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

describe("TagFilterBar", () => {
  it("列出所有 tag，无选中时不显示清除", async () => {
    const { host, root } = await renderDom(
      <TagFilterBar
        tasks={[task(["重构", "bug"]), task(["bug", "api"])]}
        selected={[]}
        onToggle={() => {}}
        onClear={() => {}}
      />,
    );
    expect(host.textContent).toContain("#bug");
    expect(host.textContent).toContain("#重构");
    expect(host.textContent).toContain("#api");
    expect(host.querySelector('[aria-label="清除筛选"]')).toBeNull();
    await unmount(root);
  });

  it("点击 tag 调 onToggle；有选中时显示清除并调 onClear", async () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();
    const { host, root } = await renderDom(
      <TagFilterBar tasks={[task(["bug"])]} selected={["bug"]} onToggle={onToggle} onClear={onClear} />,
    );
    await click(host.querySelector('[aria-label="筛选 bug"]'));
    expect(onToggle).toHaveBeenCalledWith("bug");
    await click(host.querySelector('[aria-label="清除筛选"]'));
    expect(onClear).toHaveBeenCalled();
    await unmount(root);
  });
});
