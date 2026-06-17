// @vitest-environment jsdom
import type { Task } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AttentionQueue } from "./AttentionQueue.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "示例",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    subtasks: [],
    completedCount: 0,
    turn: null,
    turnAt: null,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

const noop = () => {};
const handlers = {
  onToggle: noop,
  onEdit: noop,
  onDelete: noop,
  onToToday: noop,
  onToInbox: noop,
  onSubtasksChange: noop,
};

async function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

describe("AttentionQueue", () => {
  it("渲染等我/在跑两段，parked 折叠", async () => {
    const now = new Date("2026-06-17T10:00:00.000Z");
    const { host, root } = await render(
      createElement(AttentionQueue, {
        tasks: [
          task({ id: "me1", title: "等我A", turn: "me", turnAt: "2026-06-17T08:00:00.000Z" }),
          task({ id: "run1", title: "在跑A", turn: "running", turnAt: "2026-06-17T09:00:00.000Z" }),
          task({ id: "pk1", title: "搁置A", turn: "parked", turnAt: "2026-06-17T08:00:00.000Z" }),
        ],
        rowHandlers: handlers,
        onTurnChange: noop,
        now,
      }),
    );
    expect(host.textContent).toContain("等我处理");
    expect(host.textContent).toContain("在跑");
    expect(host.textContent).toContain("等我A");
    expect(host.textContent).toContain("在跑A");
    // 在跑行尾显示已跑时长
    expect(host.textContent).toContain("已跑");
    await act(async () => root.unmount());
  });

  it("置顶区行徽章可点切 turn", async () => {
    const now = new Date("2026-06-17T10:00:00.000Z");
    const onTurnChange = vi.fn();
    const { host, root } = await render(
      createElement(AttentionQueue, {
        tasks: [task({ id: "me1", title: "等我A", turn: "me", turnAt: "2026-06-17T08:00:00.000Z" })],
        rowHandlers: handlers,
        onTurnChange,
        now,
      }),
    );
    await act(async () => (host.querySelector('[data-testid="turn-badge"]') as HTMLElement).click());
    expect(onTurnChange).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("空队列不渲染（不挂 interval）", async () => {
    const now = new Date("2026-06-17T10:00:00.000Z");
    const { host, root } = await render(
      createElement(AttentionQueue, { tasks: [], rowHandlers: handlers, onTurnChange: noop, now }),
    );
    expect(host.textContent).not.toContain("等我处理");
    await act(async () => root.unmount());
  });
});
