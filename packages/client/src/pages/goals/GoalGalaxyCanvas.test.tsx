// @vitest-environment jsdom
import { act } from "react";
import type { Goal, GoalLayoutPin, Task } from "@timedata/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, doubleClick, renderDom, unmount } from "../../test/domHarness.js";
import { getReactFlowMock, resetReactFlowMock } from "./test/reactFlowMock.js";

const syncAfterWriteMock = vi.hoisted(() => vi.fn());
const upsertGoalLayoutPinMock = vi.hoisted(() => vi.fn());
const deleteGoalLayoutPinMock = vi.hoisted(() => vi.fn());
const toggleTaskDoneMock = vi.hoisted(() => vi.fn());
const removeGoalMemberMock = vi.hoisted(() => vi.fn());
const updateGoalPrerequisitesMock = vi.hoisted(() => vi.fn());
const addGoalMemberMock = vi.hoisted(() => vi.fn());
const addTaskForGoalMock = vi.hoisted(() => vi.fn());
const updateGoalMock = vi.hoisted(() => vi.fn());
const deleteGoalMock = vi.hoisted(() => vi.fn());

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));
vi.mock("../../contexts/SyncContext.js", () => ({ useSyncContext: () => ({ syncAfterWrite: syncAfterWriteMock }) }));
vi.mock("../../lib/goalLayoutPins.js", () => ({
  upsertGoalLayoutPin: upsertGoalLayoutPinMock,
  deleteGoalLayoutPin: deleteGoalLayoutPinMock,
}));
vi.mock("../../lib/tasks.js", () => ({ toggleTaskDone: toggleTaskDoneMock }));
vi.mock("../../lib/goals.js", () => ({
  addGoalMember: addGoalMemberMock,
  addTaskForGoal: addTaskForGoalMock,
  deleteGoal: deleteGoalMock,
  removeGoalMember: removeGoalMemberMock,
  updateGoal: updateGoalMock,
  updateGoalPrerequisites: updateGoalPrerequisitesMock,
}));

const goalGalaxyCanvasModule = await import("./GoalGalaxyCanvas.js");
const { GoalGalaxyCanvas } = goalGalaxyCanvasModule;

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    title: "G1",
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    ...overrides,
  } as Goal;
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Task;
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const button = root.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button label: ${label}`);
  return button;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button text: ${text}`);
  return button;
}

function lastButtonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].filter((item) => item.textContent === text).at(-1);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button text: ${text}`);
  return button;
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GoalGalaxyCanvas", () => {
  beforeEach(() => {
    syncAfterWriteMock.mockClear();
    upsertGoalLayoutPinMock.mockReset().mockResolvedValue(undefined);
    deleteGoalLayoutPinMock.mockReset().mockResolvedValue(undefined);
    toggleTaskDoneMock.mockReset().mockResolvedValue(undefined);
    removeGoalMemberMock.mockReset().mockResolvedValue(undefined);
    updateGoalPrerequisitesMock.mockReset().mockResolvedValue(undefined);
    addGoalMemberMock.mockReset().mockResolvedValue(undefined);
    addTaskForGoalMock.mockReset().mockResolvedValue(undefined);
    updateGoalMock.mockReset().mockResolvedValue(undefined);
    deleteGoalMock.mockReset().mockResolvedValue(undefined);
  });

  it("renders one star for each active goal and opens the focused editor on double click", async () => {
    const onNavigate = vi.fn();

    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal()]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={onNavigate} />,
    );

    const star = host.querySelector('[data-star-id="goal:g1"]');
    expect(host.querySelector("[data-galaxy]")).toBeTruthy();
    expect(star).toBeTruthy();

    await doubleClick(host.querySelector('[data-node-id="goal:g1"]'));
    expect(onNavigate).toHaveBeenCalledWith("/goals/g1");
    await unmount(root);
  });

  it("lets goal stars and single-goal members drag while bridge members stay fixed", async () => {
    const goals = [
      goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "a" }] }),
      goal({
        id: "g2",
        title: "G2",
        members: [
          { kind: "task", id: "a" },
          { kind: "task", id: "b" },
        ],
      }),
    ];

    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={goals}
        tasks={[task("a", { title: "A" }), task("b", { title: "B" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    expect(host.querySelector("[data-rf='true']")?.getAttribute("data-nodes-draggable")).toBe("true");
    expect(host.querySelector('[data-node-id="goal:g1"]')?.getAttribute("data-node-draggable")).toBe("true");
    expect(host.querySelector('[data-node-id="task:b"]')?.getAttribute("data-node-draggable")).toBe("true");
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-draggable")).toBe("false");
    await unmount(root);
  });

  it("persists a goal star world pin after drag stop", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal()]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );
    const star = host.querySelector('[data-node-id="goal:g1"]');
    const startX = Number(star?.getAttribute("data-node-x"));
    const startY = Number(star?.getAttribute("data-node-y"));

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-rf-drag-stop-node-id="goal:g1"]')?.click();
    });
    await flushPromises();

    expect(upsertGoalLayoutPinMock).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: "g1",
        nodeKind: "goal",
        nodeId: "g1",
        x: startX + 10,
        y: startY + 20,
      }),
    );
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("persists a single-goal member pin relative to its goal anchor after drag stop", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const layoutPins: GoalLayoutPin[] = [
      { goalId: "g1", nodeKind: "goal", nodeId: "g1", x: 100, y: 100, updatedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a", { title: "A" })]}
        tracks={[]}
        steps={[]}
        layoutPins={layoutPins}
        onNavigate={vi.fn()}
      />,
    );
    const member = host.querySelector('[data-node-id="task:a"]');
    const startX = Number(member?.getAttribute("data-node-x"));
    const startY = Number(member?.getAttribute("data-node-y"));

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-rf-drag-stop-node-id="task:a"]')?.click();
    });
    await flushPromises();

    expect(upsertGoalLayoutPinMock).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: "g1",
        nodeKind: "task",
        nodeId: "a",
        x: startX + 10 - 100,
        y: startY + 20 - 100,
      }),
    );
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("renders pinned badges for pinned stars and members", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const layoutPins: GoalLayoutPin[] = [
      { goalId: "g1", nodeKind: "goal", nodeId: "g1", x: 100, y: 100, updatedAt: "2026-01-01T00:00:00.000Z" },
      { goalId: "g1", nodeKind: "task", nodeId: "a", x: 30, y: -10, updatedAt: "2026-01-01T00:00:00.000Z" },
    ];

    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a", { title: "A" })]}
        tracks={[]}
        steps={[]}
        layoutPins={layoutPins}
        onNavigate={vi.fn()}
      />,
    );

    expect(host.querySelectorAll('[aria-label="已固定位置"]')).toHaveLength(2);
    await unmount(root);
  });

  it("restoreGalaxyPin deletes the selected node pin and syncs after write", async () => {
    await (goalGalaxyCanvasModule as typeof goalGalaxyCanvasModule & {
      restoreGalaxyPin: (input: { nodeId: string; anchorIds: string[]; syncAfterWrite: () => void }) => Promise<void>;
    }).restoreGalaxyPin({
      nodeId: "task:a",
      anchorIds: ["goal:g1"],
      syncAfterWrite: syncAfterWriteMock,
    });

    expect(deleteGoalLayoutPinMock).toHaveBeenCalledWith({
      goalId: "g1",
      nodeKind: "task",
      nodeId: "a",
    });
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
  });

  it("selects a member node and shows node actions", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a", { title: "A" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-node-id="task:a"]'));

    expect(buttonByLabel(document.body, "完成 A")).toBeInstanceOf(HTMLButtonElement);
    expect(buttonByLabel(document.body, "连前置 A")).toBeInstanceOf(HTMLButtonElement);
    expect(buttonByLabel(document.body, "移除成员 A")).toBeInstanceOf(HTMLButtonElement);
    await unmount(root);
  });

  it("toggles task completion from the selected member action", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a", { title: "A" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-node-id="task:a"]'));
    await click(buttonByLabel(document.body, "完成 A"));
    await flushPromises();

    expect(toggleTaskDoneMock).toHaveBeenCalledWith("a");
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("confirms and removes a single-goal member from the selected member action", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a", { title: "A" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-node-id="task:a"]'));
    await click(buttonByLabel(document.body, "移除成员 A"));
    await click([...document.body.querySelectorAll("button")].filter((button) => button.textContent === "移除成员").at(-1));
    await flushPromises();

    expect(removeGoalMemberMock).toHaveBeenCalledWith("g1", { kind: "task", id: "a" });
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("connects a prerequisite within the selected member goal", async () => {
    const goalValue = goal({
      members: [
        { kind: "task", id: "a" },
        { kind: "task", id: "b" },
      ],
    });
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a", { title: "A" }), task("b", { title: "B" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-node-id="task:a"]'));
    await click(buttonByLabel(document.body, "连前置 A"));
    await click(host.querySelector('[data-node-id="task:b"]'));
    await flushPromises();

    expect(updateGoalPrerequisitesMock).toHaveBeenCalledWith("g1", [
      { blocker: { kind: "task", id: "a" }, blocked: { kind: "task", id: "b" } },
    ]);
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("rejects a prerequisite target outside the selected member goal", async () => {
    const goals = [
      goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "a" }] }),
      goal({ id: "g2", title: "G2", members: [{ kind: "task", id: "b" }] }),
    ];
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={goals}
        tasks={[task("a", { title: "A" }), task("b", { title: "B" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-node-id="task:a"]'));
    await click(buttonByLabel(document.body, "连前置 A"));
    await click(host.querySelector('[data-node-id="task:b"]'));
    await flushPromises();

    expect(updateGoalPrerequisitesMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("只能连当前目标里的有效成员");
    await unmount(root);
  });

  it("deletes a selected prerequisite edge", async () => {
    const firstRef = { kind: "task" as const, id: "a" };
    const secondRef = { kind: "task" as const, id: "b" };
    const goalValue = goal({
      members: [firstRef, secondRef],
      prerequisites: [{ blocker: firstRef, blocked: secondRef }],
    });
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a", { title: "A" }), task("b", { title: "B" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-edge-id="prerequisite:g1:task:a->task:b"]'));
    await click(buttonByLabel(document.body, "删除前置"));
    await flushPromises();

    expect(updateGoalPrerequisitesMock).toHaveBeenCalledWith("g1", []);
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("adds an existing task member from a selected goal star", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goal({ members: [] })]}
        tasks={[task("candidate", { title: "候选任务" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-node-id="goal:g1"]'));
    await click(buttonByLabel(document.body, "添加成员 G1"));
    await click(buttonByLabel(document.body, "添加任务 候选任务"));
    await flushPromises();

    expect(addGoalMemberMock).toHaveBeenCalledWith("g1", { kind: "task", id: "candidate" });
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("edits archives and deletes a selected goal star from the goal menu", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal({ title: "G1" })]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );

    await click(host.querySelector('[data-node-id="goal:g1"]'));
    await click(buttonByLabel(document.body, "编辑目标 G1"));
    const titleInput = document.body.querySelector('input[aria-label="目标标题"]');
    if (!(titleInput instanceof HTMLInputElement)) throw new Error("missing title input");
    await setInputValue(titleInput, "  G1 updated  ");
    await click(buttonByText(document.body, "保存目标"));
    await flushPromises();

    expect(updateGoalMock).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        title: "G1 updated",
      }),
    );

    await click(buttonByText(document.body, "归档目标"));
    await flushPromises();
    expect(updateGoalMock).toHaveBeenCalledWith("g1", { status: "archived" });

    await click(lastButtonByText(document.body, "删除目标"));
    await click(lastButtonByText(document.body, "删除目标"));
    await flushPromises();

    expect(deleteGoalMock).toHaveBeenCalledWith("g1");
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(3);
    await unmount(root);
  });

  it("confirms before deleting a selected goal star from the action bar", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal({ title: "G1" })]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );

    await click(host.querySelector('[data-node-id="goal:g1"]'));
    await click(buttonByLabel(document.body, "删除目标 G1"));
    expect(deleteGoalMock).not.toHaveBeenCalled();

    await click(lastButtonByText(document.body, "删除目标"));
    await click(lastButtonByText(document.body, "删除目标"));
    await flushPromises();

    expect(deleteGoalMock).toHaveBeenCalledWith("g1");
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("routes bridge member goal-scoped removal to the selected focused editor", async () => {
    const onNavigate = vi.fn();
    const goals = [
      goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "a" }] }),
      goal({ id: "g2", title: "G2", members: [{ kind: "task", id: "a" }] }),
    ];
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={goals}
        tasks={[task("a", { title: "A" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={onNavigate}
      />,
    );

    await click(host.querySelector('[data-node-id="task:a"]'));
    await click(buttonByLabel(document.body, "移除成员 A"));
    await click(buttonByLabel(document.body, "在 G2 中编辑"));

    expect(removeGoalMemberMock).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("/goals/g2");
    await unmount(root);
  });

  it("does not render archived goals as stars", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goal({ id: "archived", title: "Archived", status: "archived" })]}
        tasks={[]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    expect(host.querySelector('[data-star-id="goal:archived"]')).toBeNull();
    await unmount(root);
  });

  it("fits the read-only overview on first mount", async () => {
    resetReactFlowMock();

    const { root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal()]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );

    expect(getReactFlowMock().fitView).toHaveBeenCalledWith({ padding: 0.2 });
    await unmount(root);
  });

  it("fits after the initial LOD pass renders expanded member nodes", async () => {
    resetReactFlowMock();
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });

    const { root } = await renderDom(
      <GoalGalaxyCanvas goals={[goalValue]} tasks={[task("a")]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );

    expect(getReactFlowMock().renderedNodes.some((nodes) => nodes.some((node) => node.id === "task:a"))).toBe(true);
    const counts = getReactFlowMock().fitViewRenderedNodeCounts;
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(2);
    await unmount(root);
  });

  it("waits to fit until live query data arrives", async () => {
    resetReactFlowMock();
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const { root } = await renderDom(
      <GoalGalaxyCanvas goals={[]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );

    await act(async () => {
      root.render(
        <GoalGalaxyCanvas goals={[goalValue]} tasks={[task("a")]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
      );
    });

    const counts = getReactFlowMock().fitViewRenderedNodeCounts;
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(2);
    await unmount(root);
  });

  it("keeps expanded clusters expanded while zoom remains inside the hysteresis band", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goalValue]} tasks={[task("a")]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );
    expect(host.querySelector('[data-node-id="task:a"]')).toBeTruthy();

    await act(async () => {
      getReactFlowMock().fireMoveEnd({ x: 0, y: 0, zoom: 0.84 });
    });

    expect(host.querySelector('[data-node-id="task:a"]')).toBeTruthy();
    await unmount(root);
  });

  it("keeps per-goal member pins separate when the same member has pins under multiple goals", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const layoutPins: GoalLayoutPin[] = [
      { goalId: "g1", nodeKind: "task", nodeId: "a", x: 40, y: 10, updatedAt: "2026-01-01T00:00:00.000Z" },
      { goalId: "other", nodeKind: "task", nodeId: "a", x: 400, y: 400, updatedAt: "2026-01-01T00:00:00.000Z" },
    ];

    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goalValue]} tasks={[task("a")]} tracks={[]} steps={[]} layoutPins={layoutPins} onNavigate={vi.fn()} />,
    );

    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-x")).toBe("40");
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-y")).toBe("10");
    await unmount(root);
  });
});
