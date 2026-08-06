// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import type { Task } from "@timedata/shared";
import { act } from "react";
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
    <div
      data-testid="swipeable-list"
      data-threshold={String(rest.threshold)}
      data-fullswipe={String(rest.fullSwipe)}
      data-classname={String(rest.className ?? "")}
    >
      {children}
    </div>
  ),
  SwipeableListItem: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div
      data-testid="swipeable-item"
      data-blockswipe={String(rest.blockSwipe)}
      data-maxswipe={String(rest.maxSwipe)}
      data-classname={String(rest.className ?? "")}
    >
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

  it("约束 swipe 容器横向溢出，resize 后条目按当前页面宽度收缩", async () => {
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
      />,
    );

    expect(host.querySelector('[data-testid="swipeable-list"]')?.getAttribute("data-classname")).toContain("min-w-0");
    expect(host.querySelector('[data-testid="swipeable-list"]')?.getAttribute("data-classname")).toContain(
      "overflow-x-clip",
    );
    expect(host.querySelector('[data-testid="swipeable-item"]')?.getAttribute("data-classname")).toContain("min-w-0");

    await unmount(root);
  });

  it("onCopyTitle 透传到行：Shift+单击标题触发复制回调", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onCopyTitle = vi.fn();
    const { host, root } = await renderDom(
      <TaskList
        pool="today"
        tasks={[task({ title: "买啤酒" })]}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onToToday={noop}
        onToInbox={noop}
        onCopyTitle={onCopyTitle}
      />,
    );

    const title = host.querySelector(".select-text") as HTMLElement | null;
    expect(title).not.toBeNull();
    title!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    await act(async () => {});

    expect(writeText).toHaveBeenCalledWith("买啤酒");
    expect(onCopyTitle).toHaveBeenCalledTimes(1);
    delete (navigator as { clipboard?: unknown }).clipboard;
    await unmount(root);
  });
});

describe("TaskList 多选态", () => {
  // 生产里 sortable 的 TaskList 挂在 TodoPage 顶层 DndContext 之下，
  // SortableContext / useSortable 要真的注册进去，拖柄才会按实现渲染或不渲染。
  const renderWithDnd = (node: React.ReactElement) => renderDom(<DndContext>{node}</DndContext>);

  // 下面这对（不渲染 / 照常渲染）守的是 TaskList 的 canSort 里那个 `!props.selectionMode`。
  // 别把它当「多选态下顺手也别拖」的口味题删掉：多选态的行用 Space 勾选（TaskRow 的 onKeyDown），
  // dnd-kit 的 KeyboardSensor 默认也用 Space 起拖，两者不打架的唯一原因就是多选态压根不渲染拖柄。
  // 拖柄一旦回来，多选态下按一次 Space 会同时起拖 + 勾选。
  it("多选态下不渲染拖柄（sortable 被关掉）", async () => {
    const { host, root } = await renderWithDnd(
      <TaskList
        pool="inbox"
        tasks={[task({ id: "t1", title: "买灯" })]}
        sortable
        containerId="pool:inbox"
        selectionMode
        selectedIds={new Set<string>()}
        onToggleSelect={vi.fn()}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToToday={vi.fn()}
        onToInbox={vi.fn()}
      />,
    );
    // 拖柄是 SortableTaskRow 才给的；多选态下 canSort=false，整行退回静态渲染。
    expect(host.querySelector('[data-testid="task-row-grab-area"]')).toBeNull();
    await unmount(root);
  });

  // 反向基线：没有它，上一条可能因为别的原因（比如漏传 sortable）假绿。
  it("非多选态照常渲染拖柄", async () => {
    const { host, root } = await renderWithDnd(
      <TaskList
        pool="inbox"
        tasks={[task({ id: "t1", title: "买灯" })]}
        sortable
        containerId="pool:inbox"
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToToday={vi.fn()}
        onToInbox={vi.fn()}
      />,
    );
    expect(host.querySelector('[data-testid="task-row-grab-area"]')).not.toBeNull();
    await unmount(root);
  });

  it("selectedIds 决定行的选中态", async () => {
    const { host, root } = await renderWithDnd(
      <TaskList
        pool="inbox"
        tasks={[task({ id: "t1", title: "买灯" }), task({ id: "t2", title: "买椅子" })]}
        selectionMode
        selectedIds={new Set(["t2"])}
        onToggleSelect={vi.fn()}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToToday={vi.fn()}
        onToInbox={vi.fn()}
      />,
    );
    expect(host.querySelector('[aria-label="选择 买灯"]')?.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[aria-label="选择 买椅子"]')?.getAttribute("aria-checked")).toBe("true");
    await unmount(root);
  });

  it("多选态下禁掉左右滑（粗指针也 blockSwipe）", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(true);
    const { host, root } = await renderWithDnd(
      <TaskList
        pool="inbox"
        tasks={[task({ id: "t1", title: "买灯" })]}
        selectionMode
        selectedIds={new Set<string>()}
        onToggleSelect={vi.fn()}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToToday={vi.fn()}
        onToInbox={vi.fn()}
      />,
    );
    // 多选态下整行点击 = 勾选，滑动手势与它抢同一片区域，必须一起关掉。
    expect(host.querySelector('[data-testid="swipeable-item"]')?.getAttribute("data-blockswipe")).toBe("true");
    await unmount(root);
  });
});

describe("TaskList · dndIdPrefix", () => {
  it("dndIdPrefix 同时作用于 SortableContext 与行注册", async () => {
    // 两处必须同源：items 用裸 id 而行注册用前缀 id 时，dnd-kit 认不出这行属于本 context，
    // 表现为「拖起来没有避让动画、松手落点乱跳」。
    const { host, root } = await renderDom(
      <DndContext>
        <TaskList
          pool="inbox"
          tasks={[task({ id: "t1" }), task({ id: "t2" })]}
          sortable
          containerId="project:g1"
          dndIdPrefix="project-row:g1:"
          onToggle={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onToToday={vi.fn()}
          onToInbox={vi.fn()}
        />
      </DndContext>,
    );
    const ids = [...host.querySelectorAll("[data-dnd-id]")].map((el) => el.getAttribute("data-dnd-id"));
    expect(ids).toEqual(["project-row:g1:t1", "project-row:g1:t2"]);
    await unmount(root);
  });

  it("不传 dndIdPrefix 时其余各区的行 id 一字不变", async () => {
    const { host, root } = await renderDom(
      <DndContext>
        <TaskList
          pool="inbox"
          tasks={[task({ id: "t1" })]}
          sortable
          containerId="pool:inbox"
          onToggle={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onToToday={vi.fn()}
          onToInbox={vi.fn()}
        />
      </DndContext>,
    );
    expect(host.querySelector("[data-dnd-id]")?.getAttribute("data-dnd-id")).toBe("t1");
    await unmount(root);
  });
});
