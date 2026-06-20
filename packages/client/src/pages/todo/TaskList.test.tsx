// @vitest-environment jsdom
import type { Task } from "@timedata/shared";
import { describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { TaskList } from "./TaskList.js";

vi.mock("../../lib/useIsCoarsePointer.js", () => ({
  useIsCoarsePointer: vi.fn(() => false),
}));

const { useIsCoarsePointer } = await import("../../lib/useIsCoarsePointer.js");

vi.mock("@meauxt/react-swipeable-list", () => ({
  Type: { IOS: "IOS" },
  LeadingActions: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TrailingActions: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SwipeAction: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SwipeableList: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid="swipeable-list" data-threshold={String(rest.threshold)} data-fullswipe={String(rest.fullSwipe)}>
      {children}
    </div>
  ),
  SwipeableListItem: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid="swipeable-item" data-blockswipe={String(rest.blockSwipe)} data-maxswipe={String(rest.maxSwipe)}>
      {children}
    </div>
  ),
}));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "示例",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

const noop = () => {};

describe("TaskList prop 透传", () => {
  it("桌面（细指针）下：blockSwipe=true、maxSwipe=0.5、threshold=0.3", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(false);
    const { host, root } = await renderDom(
      <TaskList
        pool="today"
        tasks={[task()]}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onToToday={noop}
        onToInbox={noop}
        onSubtasksChange={noop}
      />,
    );

    const list = host.querySelector('[data-testid="swipeable-list"]');
    const item = host.querySelector('[data-testid="swipeable-item"]');
    expect(list?.getAttribute("data-threshold")).toBe("0.3");
    expect(list?.getAttribute("data-fullswipe")).toBe("false");
    expect(item?.getAttribute("data-blockswipe")).toBe("true");
    expect(item?.getAttribute("data-maxswipe")).toBe("0.5");

    await unmount(root);
  });

  it("移动端（粗指针）下：blockSwipe=false、maxSwipe=0.5、threshold=0.3", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(true);
    const { host, root } = await renderDom(
      <TaskList
        pool="today"
        tasks={[task()]}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onToToday={noop}
        onToInbox={noop}
        onSubtasksChange={noop}
      />,
    );

    const item = host.querySelector('[data-testid="swipeable-item"]');
    expect(item?.getAttribute("data-blockswipe")).toBe("false");
    expect(item?.getAttribute("data-maxswipe")).toBe("0.5");

    await unmount(root);
  });
});
