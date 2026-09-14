// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import type { Task } from "@timedata/shared";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TaskList } from "./TaskList.js";

vi.mock("../../lib/useIsCoarsePointer.js", () => ({
  useIsCoarsePointer: vi.fn(() => false),
}));

const { useIsCoarsePointer } = await import("../../lib/useIsCoarsePointer.js");

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

/** 第 index 行滑动动作条里的按钮名，左侧在前、右侧在后。按钮只有图标，名字在 aria-label 上。 */
function swipeActionLabels(host: HTMLElement, index = 0): string[] {
  const row = host.querySelectorAll("[data-swipe-row]")[index];
  return [...(row?.querySelectorAll("[data-swipe-actions] button") ?? [])].map(
    (b) => b.getAttribute("aria-label") ?? "",
  );
}

describe("TaskList 滑动动作", () => {
  it("桌面（细指针）下不渲染滑动动作条——动作走行尾悬停按钮", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(false);
    const { host, root } = await renderDom(
      <TaskList
        pool="today"
        tasks={[task({ ruleId: null })]}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onToToday={noop}
        onToInbox={noop}
      />,
    );

    expect(host.querySelector("[data-swipe-row]")).not.toBeNull();
    expect(host.querySelector("[data-swipe-actions]")).toBeNull();

    await unmount(root);
  });

  it("触屏 today 池：右侧依次回收件箱 / 抓到手头 / 删除，左侧没有动作", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(true);
    const { host, root } = await renderDom(
      <TaskList
        pool="today"
        tasks={[task({ ruleId: null })]}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onToToday={noop}
        onToInbox={noop}
        onToHand={noop}
      />,
    );

    expect(host.querySelector('[data-swipe-actions="leading"]')).toBeNull();
    expect(swipeActionLabels(host)).toEqual(["回收件箱 示例", "抓到手头 示例", "删除 示例"]);

    await unmount(root);
  });

  it("混池按行覆盖：排了今天且已在手头的行只给回收件箱 + 删除，收件箱行给排进今天 + 抓到手头 + 删除", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(true);
    const { host, root } = await renderDom(
      <TaskList
        pool="inbox"
        rowPool={(t) => (t.id === "a" ? "today" : "inbox")}
        atHandIds={new Set(["a"])}
        tasks={[task({ id: "a", title: "甲", ruleId: null }), task({ id: "b", title: "乙", ruleId: null })]}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onToToday={noop}
        onToInbox={noop}
        onToHand={noop}
      />,
    );

    expect(swipeActionLabels(host, 0)).toEqual(["回收件箱 甲", "删除 甲"]);
    expect(swipeActionLabels(host, 1)).toEqual(["排进今天 乙", "抓到手头 乙", "删除 乙"]);

    await unmount(root);
  });

  it("已完成列表只给删除", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(true);
    const { host, root } = await renderDom(
      <TaskList
        pool="completed"
        tasks={[task({ done: true })]}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onToToday={noop}
        onToInbox={noop}
        onToHand={noop}
      />,
    );

    expect(swipeActionLabels(host)).toEqual(["删除 示例"]);

    await unmount(root);
  });

  it("点动作按钮把本行任务交给对应回调", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(true);
    const onToInbox = vi.fn();
    const onDelete = vi.fn();
    const item = task({ ruleId: null });
    const { host, root } = await renderDom(
      <TaskList
        pool="today"
        tasks={[item]}
        onToggle={noop}
        onEdit={noop}
        onDelete={onDelete}
        onToToday={noop}
        onToInbox={onToInbox}
      />,
    );

    await click(host.querySelector('[aria-label="回收件箱 示例"]'));
    await click(host.querySelector('[aria-label="删除 示例"]'));

    expect(onToInbox).toHaveBeenCalledWith(item);
    expect(onDelete).toHaveBeenCalledWith(item);

    await unmount(root);
  });

  it("约束列表容器横向溢出，行容器可按页面宽度收缩", async () => {
    vi.mocked(useIsCoarsePointer).mockReturnValue(true);
    const { host, root } = await renderDom(
      <TaskList
        pool="today"
        tasks={[task({ ruleId: null })]}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onToToday={noop}
        onToInbox={noop}
      />,
    );

    const list = host.querySelector('[data-testid="task-list"]');
    expect(list?.className).toContain("min-w-0");
    expect(list?.className).toContain("overflow-x-clip");
    expect(host.querySelector("[data-swipe-row]")?.className).toContain("min-w-0");

    await unmount(root);
  });
});

describe("TaskList 透传", () => {
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
    // biome-ignore lint/performance/noDelete: jsdom 的 navigator 跨测试文件共享，赋 undefined 会留下键、让被测代码的 clipboard 存在性判断走错分支（改成赋值曾让 TaskRow 用例翻红）
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

  it("多选态下禁掉左右滑（粗指针也不渲染动作条）", async () => {
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
    expect(host.querySelector("[data-swipe-row]")).not.toBeNull();
    expect(host.querySelector("[data-swipe-actions]")).toBeNull();
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
