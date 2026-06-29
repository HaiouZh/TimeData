// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@timedata/shared";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { SunkenInboxTail } from "./SunkenInboxTail.js";

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t1",
    parentId: null,
    title: overrides.title ?? "水下任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    weight: 0,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

const handlers = {
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToToday: vi.fn(),
  onToInbox: vi.fn(),
  onAfterChildWrite: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SunkenInboxTail", () => {
  it("renders null when sunkenTasks is empty", async () => {
    const { host, root } = await renderDom(
      <SunkenInboxTail sunkenTasks={[]} stickyBottomOffsetPx={0} {...handlers} />,
    );
    expect(host.children.length).toBe(0);
    await unmount(root);
  });

  it("collapsed state shows only 水下 X 条", async () => {
    const { host, root } = await renderDom(
      <SunkenInboxTail sunkenTasks={[task({ id: "a" }), task({ id: "b" })]} stickyBottomOffsetPx={0} {...handlers} />,
    );
    expect(host.textContent).toContain("水下 2 条");
    // 折叠状态不显示任务标题
    expect(host.textContent).not.toContain("水下任务");
    await unmount(root);
  });

  it("clicking opens full list", async () => {
    const { host, root } = await renderDom(
      <SunkenInboxTail sunkenTasks={[task({ id: "a", title: "沉没想法" })]} stickyBottomOffsetPx={0} {...handlers} />,
    );
    const btn = host.querySelector("button") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    await click(btn);
    expect(host.textContent).toContain("沉没想法");
    await unmount(root);
  });

  it("expanded list renders tasks grouped by date", async () => {
    const tasks = [
      task({ id: "a", title: "任务A", updatedAt: "2026-06-28T00:00:00.000Z" }),
      task({ id: "b", title: "任务B", updatedAt: "2026-06-27T00:00:00.000Z" }),
    ];
    const { host, root } = await renderDom(
      <SunkenInboxTail sunkenTasks={tasks} stickyBottomOffsetPx={0} {...handlers} />,
    );
    await click(host.querySelector("button") as HTMLButtonElement);
    expect(host.textContent).toContain("任务A");
    expect(host.textContent).toContain("任务B");
    await unmount(root);
  });

  it("does not pass sortable or containerId to TaskList", async () => {
    const { host, root } = await renderDom(
      <SunkenInboxTail sunkenTasks={[task({ id: "a" })]} stickyBottomOffsetPx={0} {...handlers} />,
    );
    await click(host.querySelector("button") as HTMLButtonElement);
    // 水下尾部不应有拖拽抓取区
    expect(host.querySelector('[data-testid="task-row-grab-area"]')).toBeNull();
    await unmount(root);
  });

  it("extraAction renders 顶一下 and click calls bump", async () => {
    const onBump = vi.fn();
    const extraAction = (t: Task) => (
      <button
        type="button"
        aria-label={`顶一下 ${t.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onBump(t);
        }}
      >
        顶
      </button>
    );
    const { host, root } = await renderDom(
      <SunkenInboxTail
        sunkenTasks={[task({ id: "a", title: "可顶" })]}
        stickyBottomOffsetPx={0}
        extraAction={extraAction}
        {...handlers}
      />,
    );
    await click(host.querySelector("button") as HTMLButtonElement);
    const bumpBtn = host.querySelector<HTMLButtonElement>('button[aria-label="顶一下 可顶"]');
    expect(bumpBtn).not.toBeNull();
    await click(bumpBtn);
    expect(onBump).toHaveBeenCalledTimes(1);
    await unmount(root);
  });
});