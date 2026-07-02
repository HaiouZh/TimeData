// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal, GoalLayoutPin, GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import { db } from "../../db/index.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { getReactFlowMock, resetReactFlowMock } from "./test/reactFlowMock.js";

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));
vi.mock("../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));
vi.mock("../../lib/useIsCoarsePointer.js", () => ({ useIsCoarsePointer: () => false }));
vi.mock("../../lib/settings/todoDefaultDestinationSetting.js", () => ({ useTodoDefaultDestination: () => "today" }));

const { GoalGraphEditor } = await import("./GoalGraphEditor.js");

const now = "2026-06-23T00:00:00.000Z";
let mountedRoot: Awaited<ReturnType<typeof renderDom>>["root"] | null = null;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (mountedRoot) await unmount(mountedRoot);
  mountedRoot = null;
  await db.delete();
});

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    title: "发布 v2",
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    parentId: null,
    title: id,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function seed(goalValue: Goal, tasks: Task[] = [], tracks: Track[] = []): Promise<void> {
  await db.goals.add(goalValue);
  await db.tasks.bulkAdd(tasks);
  if (tracks.length > 0) await db.tracks.bulkAdd(tracks);
}

async function renderEditor(options: {
  goal?: Goal;
  tasks?: Task[];
  tracks?: Track[];
  steps?: TrackStep[];
  layoutPins?: GoalLayoutPin[];
  onNavigate?: (to: string) => void;
  onDeletedGoal?: () => void;
} = {}) {
  const goalValue = options.goal ?? goal();
  const rendered = await renderDom(
    createElement(GoalGraphEditor, {
      goal: goalValue,
      tasks: options.tasks ?? [],
      tracks: options.tracks ?? [],
      steps: options.steps ?? [],
      layoutPins: options.layoutPins ?? [],
      onNavigate: options.onNavigate ?? vi.fn(),
      onDeletedGoal: options.onDeletedGoal ?? vi.fn(),
    }),
  );
  mountedRoot = rendered.root;
  return rendered;
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForStatusText(text: string): Promise<HTMLElement> {
  for (let index = 0; index < 30; index++) {
    const status = document.body.querySelector('[role="status"]');
    if (status instanceof HTMLElement && status.textContent?.includes(text)) return status;
    await tick();
  }
  throw new Error(`missing status text: ${text}`);
}

async function waitForGoalWhere(predicate: (goal: Goal | undefined) => boolean, label: string): Promise<Goal | undefined> {
  for (let index = 0; index < 30; index++) {
    const row = await db.goals.get("goal-1");
    if (predicate(row)) return row;
    await tick();
  }
  throw new Error(`goal condition not met: ${label}`);
}

function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const button = root.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button label: ${label}`);
  return button;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button: ${text}`);
  return button;
}

function nodeButton(host: ParentNode, id: string): HTMLButtonElement {
  const button = host.querySelector(`[data-node-id="${id}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing node: ${id}`);
  return button;
}

function edgeButton(host: ParentNode, id: string): HTMLButtonElement {
  const button = host.querySelector(`[data-edge-id="${id}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing edge: ${id}`);
  return button;
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GoalGraphEditor", () => {
  it("空 Goal 渲染锚节点和工具栏添加成员入口", async () => {
    const goalValue = goal();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue });

    expect(host.querySelector('[data-rf="true"]')).not.toBeNull();
    expect(host.querySelector('[data-node-id="goal"]')).not.toBeNull();
    expect(buttonByLabel(host, "添加成员")).toBeInstanceOf(HTMLButtonElement);
  });

  it("React Flow 画布填满编辑器容器", async () => {
    const goalValue = goal();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue });
    const canvasFrame = host.querySelector("[data-goal-graph-canvas]");
    const flowCanvas = host.querySelector('[data-rf="true"]');

    expect(canvasFrame).toBeInstanceOf(HTMLElement);
    expect(canvasFrame?.className).toContain("relative");
    expect(canvasFrame?.className).toContain("min-w-0");
    expect(canvasFrame?.className).toContain("flex-1");
    expect(flowCanvas).toBeInstanceOf(HTMLElement);
    expect(flowCanvas?.className).toContain("h-full");
    expect(flowCanvas?.className).toContain("w-full");
    expect(canvasFrame).toContain(flowCanvas);
  });

  it("React Flow 节点不套全局 transform 过渡，避免拖拽闪烁", async () => {
    const goalValue = goal();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue });
    const flowCanvas = host.querySelector('[data-rf="true"]');

    expect(flowCanvas?.className).toContain("h-full");
    expect(flowCanvas?.className).not.toContain("react-flow__node");
    expect(flowCanvas?.className).not.toContain("transition-transform");
  });

  it("星图根容器填满页面并隐藏 React Flow attribution", async () => {
    const goalValue = goal();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue });
    const root = host.querySelector("[data-goal-graph-editor]");
    const flowCanvas = host.querySelector('[data-rf="true"]');

    expect(root).toBeInstanceOf(HTMLElement);
    expect(root?.className).toContain("relative");
    expect(root?.className).toContain("h-full");
    expect(root?.className).toContain("min-h-0");
    expect(flowCanvas?.getAttribute("data-node-origin")).toBe("0.5,0.5");
    expect(flowCanvas?.getAttribute("data-hide-attribution")).toBe("true");
    expect(flowCanvas?.getAttribute("data-nodes-draggable")).toBe("true");
    expect(host.querySelector('[data-node-id="goal"]')?.getAttribute("data-node-draggable")).toBe("true");
  });

  it("首次没有保存 viewport 时自动 fitView 一次", async () => {
    resetReactFlowMock();
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    await seed(goalValue, [taskValue]);

    await renderEditor({ goal: goalValue, tasks: [taskValue] });
    await tick();

    expect(getReactFlowMock().fitView).toHaveBeenCalledWith({ padding: 0.25 });
  });

  it("layout pins place goal anchor in world coordinates and members relative to it", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({
      goal: goalValue,
      tasks: [taskValue],
      layoutPins: [
        { goalId: "goal-1", nodeKind: "goal", nodeId: "goal-1", x: 100, y: 200, updatedAt: now },
        { goalId: "goal-1", nodeKind: "task", nodeId: "task-1", x: 30, y: -10, updatedAt: now },
      ],
    });

    expect(nodeButton(host, "goal").getAttribute("data-node-x")).toBe("100");
    expect(nodeButton(host, "goal").getAttribute("data-node-y")).toBe("200");
    expect(nodeButton(host, "task:task-1").getAttribute("data-node-x")).toBe("130");
    expect(nodeButton(host, "task:task-1").getAttribute("data-node-y")).toBe("190");
  });

  it("拖成员后写入相对 goal 锚的 pin", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({
      goal: goalValue,
      tasks: [taskValue],
      layoutPins: [{ goalId: "goal-1", nodeKind: "goal", nodeId: "goal-1", x: 100, y: 200, updatedAt: now }],
    });
    const taskNode = nodeButton(host, "task:task-1");
    const startX = Number(taskNode.getAttribute("data-node-x"));
    const startY = Number(taskNode.getAttribute("data-node-y"));

    await click(host.querySelector("[data-rf-drag-stop-node-id='task:task-1']"));
    await tick();

    expect(await db.goalLayoutPins.get(["goal-1", "task", "task-1"])).toMatchObject({
      x: startX + 10 - 100,
      y: startY + 20 - 200,
    });
  });

  it("拖成员时只移动当前节点，拖停后不重排邻近节点", async () => {
    const goalValue = goal({
      members: [
        { kind: "task", id: "task-1" },
        { kind: "task", id: "task-2" },
      ],
    });
    const first = task("task-1", { title: "A" });
    const second = task("task-2", { title: "B" });
    await seed(goalValue, [first, second]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [first, second] });
    const dragged = nodeButton(host, "task:task-1");
    const draggedStartX = Number(dragged.getAttribute("data-node-x"));
    const draggedStartY = Number(dragged.getAttribute("data-node-y"));
    const neighbor = nodeButton(host, "task:task-2");
    const startX = neighbor.getAttribute("data-node-x");
    const startY = neighbor.getAttribute("data-node-y");

    await click(host.querySelector("[data-rf-drag-node-id='task:task-1']"));

    expect(Number(nodeButton(host, "task:task-1").getAttribute("data-node-x"))).toBe(draggedStartX + 10);
    expect(Number(nodeButton(host, "task:task-1").getAttribute("data-node-y"))).toBe(draggedStartY + 20);
    expect(nodeButton(host, "task:task-2").getAttribute("data-node-x")).toBe(startX);
    expect(nodeButton(host, "task:task-2").getAttribute("data-node-y")).toBe(startY);

    await click(host.querySelector("[data-rf-drag-stop-node-id='task:task-1']"));

    expect(Number(nodeButton(host, "task:task-1").getAttribute("data-node-x"))).toBe(draggedStartX + 20);
    expect(Number(nodeButton(host, "task:task-1").getAttribute("data-node-y"))).toBe(draggedStartY + 40);
    expect(nodeButton(host, "task:task-2").getAttribute("data-node-x")).toBe(startX);
    expect(nodeButton(host, "task:task-2").getAttribute("data-node-y")).toBe(startY);
  });

  it("拖 goal 锚时 goal 和成员一起平移", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [taskValue] });
    const goalNode = nodeButton(host, "goal");
    const goalStartX = Number(goalNode.getAttribute("data-node-x"));
    const goalStartY = Number(goalNode.getAttribute("data-node-y"));
    const member = nodeButton(host, "task:task-1");
    const startX = Number(member.getAttribute("data-node-x"));
    const startY = Number(member.getAttribute("data-node-y"));

    await click(host.querySelector("[data-rf-drag-node-id='goal']"));

    expect(Number(nodeButton(host, "goal").getAttribute("data-node-x"))).toBe(goalStartX + 10);
    expect(Number(nodeButton(host, "goal").getAttribute("data-node-y"))).toBe(goalStartY + 20);
    expect(Number(nodeButton(host, "task:task-1").getAttribute("data-node-x"))).toBe(startX + 10);
    expect(Number(nodeButton(host, "task:task-1").getAttribute("data-node-y"))).toBe(startY + 20);
  });

  it("前置边按节点相对位置选择几何端点，避免反向绕线", async () => {
    const members: GoalMemberRef[] = [
      { kind: "task", id: "left" },
      { kind: "task", id: "right" },
    ];
    const goalValue = goal({
      members,
      prerequisites: [{ blocker: members[0], blocked: members[1] }],
    });
    const left = task("left", { title: "Left" });
    const right = task("right", { title: "Right" });
    await seed(goalValue, [left, right]);

    const { host } = await renderEditor({
      goal: goalValue,
      tasks: [left, right],
      layoutPins: [
        { goalId: "goal-1", nodeKind: "task", nodeId: "left", x: -200, y: 0, updatedAt: now },
        { goalId: "goal-1", nodeKind: "task", nodeId: "right", x: 200, y: 0, updatedAt: now },
      ],
    });

    const leftToRight = edgeButton(host, "prerequisite:task:left->task:right");
    expect(leftToRight.getAttribute("data-edge-source-handle")).toBe("source-center");
    expect(leftToRight.getAttribute("data-edge-target-handle")).toBe("target-center");
  });

  it("局部编辑器使用共享前置边渲染器和默认透明度", async () => {
    const members: GoalMemberRef[] = [
      { kind: "task", id: "task-1" },
      { kind: "task", id: "task-2" },
    ];
    const goalValue = goal({
      members,
      prerequisites: [{ blocker: members[0], blocked: members[1] }],
    });
    const first = task("task-1", { title: "第一步" });
    const second = task("task-2", { title: "第二步" });
    await seed(goalValue, [first, second]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [first, second] });
    const edge = edgeButton(host, "prerequisite:task:task-1->task:task-2");

    expect(host.querySelector("[data-rf='true']")?.getAttribute("data-edge-types")).toBe("goal-graph-edge");
    expect(edge.getAttribute("data-edge-data-kind")).toBe("prerequisite");
    expect(edge.getAttribute("data-edge-data-opacity")).toBe("");
  });

  it("拖 goal 锚后写入 world pin", async () => {
    const goalValue = goal();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue });
    const goalNode = nodeButton(host, "goal");
    const startX = Number(goalNode.getAttribute("data-node-x"));
    const startY = Number(goalNode.getAttribute("data-node-y"));

    await click(host.querySelector("[data-rf-drag-stop-node-id='goal']"));
    await tick();

    expect(await db.goalLayoutPins.get(["goal-1", "goal", "goal-1"])).toMatchObject({
      x: startX + 10,
      y: startY + 20,
    });
  });

  it("ghost node is not draggable and does not write pin", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "missing-task" }] });
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue, tasks: [], layoutPins: [] });

    const ghost = host.querySelector('[data-node-id="ghost:task:missing-task"]');
    expect(ghost?.getAttribute("data-node-draggable")).toBe("false");

    await click(host.querySelector("[data-rf-drag-stop-node-id='ghost:task:missing-task']"));
    await tick();

    expect(await db.goalLayoutPins.count()).toBe(0);
  });

  it("恢复自动 action deletes the selected node pin", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    await seed(goalValue, [taskValue]);
    await db.goalLayoutPins.add({
      goalId: "goal-1",
      nodeKind: "task",
      nodeId: "task-1",
      x: 30,
      y: -10,
      updatedAt: now,
    });

    const { host } = await renderEditor({
      goal: goalValue,
      tasks: [taskValue],
      layoutPins: await db.goalLayoutPins.toArray(),
    });

    await click(nodeButton(host, "task:task-1"));
    await click(buttonByLabel(document.body, "恢复自动 写说明"));
    await tick();

    expect(await db.goalLayoutPins.get(["goal-1", "task", "task-1"])).toBeUndefined();
  });

  it("恢复自动布局确认后只清成员 pins 并保留 goal world pin", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    await seed(goalValue, [taskValue]);
    await db.goalLayoutPins.bulkAdd([
      { goalId: "goal-1", nodeKind: "goal", nodeId: "goal-1", x: 100, y: 200, updatedAt: now },
      { goalId: "goal-1", nodeKind: "task", nodeId: "task-1", x: 30, y: -10, updatedAt: now },
    ]);

    const { host } = await renderEditor({
      goal: goalValue,
      tasks: [taskValue],
      layoutPins: await db.goalLayoutPins.toArray(),
    });

    await click(buttonByLabel(host, "恢复自动布局"));
    await click([...document.body.querySelectorAll("button")].filter((button) => button.textContent === "恢复自动布局").at(-1));
    await tick();

    expect(await db.goalLayoutPins.get(["goal-1", "goal", "goal-1"])).toBeTruthy();
    expect(await db.goalLayoutPins.get(["goal-1", "task", "task-1"])).toBeUndefined();
  });

  it("工具栏在画布浮层上保持可点击", async () => {
    const goalValue = goal();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue });
    const addMemberButton = buttonByLabel(host, "添加成员");
    const toolbarOverlay = addMemberButton.closest(".pointer-events-none");

    expect(toolbarOverlay).toBeInstanceOf(HTMLElement);
    expect(toolbarOverlay?.querySelector(".pointer-events-auto")).toContain(addMemberButton);
  });

  it("点击返回触发回到目标星图导航", async () => {
    const goalValue = goal();
    const onNavigate = vi.fn<(to: string) => void>();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue, onNavigate });

    await click(buttonByLabel(host, "返回目标星图"));

    expect(onNavigate).toHaveBeenCalledWith("/goals");
  });

  it("点节点只选中，打开动作才导航到任务深链", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    const onNavigate = vi.fn<(to: string) => void>();
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [taskValue], onNavigate });

    await click(nodeButton(host, "task:task-1"));
    expect(onNavigate).not.toHaveBeenCalled();

    await click(buttonByLabel(document.body, "打开 写说明"));
    expect(onNavigate).toHaveBeenCalledWith("/todo?taskId=task-1");
  });

  it("Task 快速完成写入 db", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [taskValue] });

    await click(nodeButton(host, "task:task-1"));
    await click(buttonByLabel(document.body, "完成 写说明"));
    await tick();

    expect((await db.tasks.get("task-1"))?.done).toBe(true);
  });

  it("移出成员后轻撤销还原成员和级联删除的前置", async () => {
    const members: GoalMemberRef[] = [
      { kind: "task", id: "task-1" },
      { kind: "task", id: "task-2" },
    ];
    const goalValue = goal({
      members,
      prerequisites: [{ blocker: members[0], blocked: members[1] }],
    });
    const first = task("task-1", { title: "A" });
    const second = task("task-2", { title: "B" });
    await seed(goalValue, [first, second]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [first, second] });

    await click(nodeButton(host, "task:task-1"));
    await click(buttonByLabel(document.body, "移除成员 A"));
    await tick();

    let row = await db.goals.get("goal-1");
    expect(row?.members).toEqual([members[1]]);
    expect(row?.prerequisites).toEqual([]);
    await waitForStatusText("撤销");

    await click(document.body.querySelector("[data-goal-undo-action]"));

    row = await waitForGoalWhere((candidate) => candidate?.members.length === 2, "restored members");
    expect(row?.members).toEqual(members);
    expect(row?.prerequisites).toEqual([{ blocker: members[0], blocked: members[1] }]);
  });

  it("onConnect 校验通过后写入 blocker -> blocked 前置", async () => {
    const members: GoalMemberRef[] = [
      { kind: "task", id: "t1" },
      { kind: "task", id: "t2" },
    ];
    const goalValue = goal({ members });
    const first = task("t1");
    const second = task("t2");
    await seed(goalValue, [first, second]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [first, second] });

    await click(host.querySelector("[data-rf-connect='true']"));
    await tick();

    expect((await db.goals.get("goal-1"))?.prerequisites).toEqual([{ blocker: members[0], blocked: members[1] }]);
  });

  it("删前置边后可撤销", async () => {
    const members: GoalMemberRef[] = [
      { kind: "task", id: "task-1" },
      { kind: "task", id: "task-2" },
    ];
    const goalValue = goal({
      members,
      prerequisites: [{ blocker: members[0], blocked: members[1] }],
    });
    const first = task("task-1", { title: "A" });
    const second = task("task-2", { title: "B" });
    await seed(goalValue, [first, second]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [first, second] });
    const edgeId = "prerequisite:task:task-1->task:task-2";

    await click(edgeButton(host, edgeId));
    await click(buttonByLabel(document.body, "删除前置"));
    await tick();

    expect((await db.goals.get("goal-1"))?.prerequisites).toEqual([]);
    await waitForStatusText("撤销");

    await click(document.body.querySelector("[data-goal-undo-action]"));

    const restored = await waitForGoalWhere(
      (candidate) => candidate?.prerequisites.length === 1,
      "restored prerequisite",
    );
    expect(restored?.prerequisites).toEqual([{ blocker: members[0], blocked: members[1] }]);
  });

  it("添加已有成员和快建任务写入 db", async () => {
    const goalValue = goal();
    const taskValue = task("task-1", { title: "已有任务" });
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [taskValue] });

    await click(buttonByLabel(host, "添加成员"));
    await click(buttonByLabel(host, "添加任务 已有任务"));
    await tick();
    expect((await db.goals.get("goal-1"))?.members).toEqual([{ kind: "task", id: "task-1" }]);

    const input = host.querySelector('input[aria-label="新建任务并加入"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing quick create input");
    await setInputValue(input, "  新任务  ");
    await click(buttonByText(host, "加入"));
    await tick();

    const tasks = await db.tasks.toArray();
    expect(tasks.map((item) => item.title).sort()).toEqual(["已有任务", "新任务"]);
    expect((await db.goals.get("goal-1"))?.members).toHaveLength(2);
  });

  it("宽屏添加成员打开右侧面板", async () => {
    const goalValue = goal();
    const taskValue = task("task-1", { title: "已有任务" });
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [taskValue] });

    await click(buttonByLabel(host, "添加成员"));

    const panel = host.querySelector('aside[aria-label="添加成员"]');
    expect(panel?.getAttribute("aria-label")).toBe("添加成员");
    expect(panel?.textContent).toContain("已有任务");
  });

  it("宽屏目标菜单打开右侧编辑面板", async () => {
    const goalValue = goal({ title: "测试目标" });
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue });

    await click(buttonByLabel(host, "目标菜单"));

    const panel = host.querySelector('aside[aria-label="目标设置"]');
    expect(panel?.getAttribute("aria-label")).toBe("目标设置");
    const titleInput = panel?.querySelector('input[aria-label="目标标题"]');
    expect(titleInput).toBeInstanceOf(HTMLInputElement);
    expect((titleInput as HTMLInputElement).value).toBe("测试目标");
  });

  it("目标菜单可编辑、归档和删除目标", async () => {
    const goalValue = goal();
    const onDeletedGoal = vi.fn<() => void>();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue, onDeletedGoal });

    await click(buttonByLabel(host, "目标菜单"));
    const titleInput = document.body.querySelector('input[aria-label="目标标题"]');
    if (!(titleInput instanceof HTMLInputElement)) throw new Error("missing title input");
    await setInputValue(titleInput, "  发布 v3  ");
    await click(buttonByText(document.body, "保存目标"));
    await tick();

    expect((await db.goals.get("goal-1"))?.title).toBe("发布 v3");

    await click(buttonByText(document.body, "归档目标"));
    await tick();
    expect((await db.goals.get("goal-1"))?.status).toBe("archived");

    await click(buttonByText(document.body, "删除目标"));
    await click([...document.body.querySelectorAll("button")].filter((button) => button.textContent === "删除目标").at(-1));
    await tick();

    expect(await db.goals.get("goal-1")).toBeUndefined();
    expect(onDeletedGoal).toHaveBeenCalledTimes(1);
  });
});
