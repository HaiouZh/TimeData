// @vitest-environment jsdom

import type { Goal, GoalLayoutPin, Task } from "@timedata/shared";
import { act } from "react";
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
const settleReheatMock = vi.hoisted(() => vi.fn());
const settleSetDragPinMock = vi.hoisted(() => vi.fn());

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
vi.mock("../../lib/settings/trackActionTagsSetting.js", () => ({
  useTrackActionTags: () => ["待我处理", "agent在做"],
}));
vi.mock("./useGalaxySettleEngine.js", () => ({
  useGalaxySettleEngine: () => ({ reheat: settleReheatMock, setDragPin: settleSetDragPinMock }),
}));

const goalGalaxyCanvasModule = await import("./GoalGalaxyCanvas.js");
const { GoalGalaxyCanvas } = goalGalaxyCanvasModule;
const { restoreGalaxyPin } = await import("./restoreGalaxyPin.js");

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

function buttonByEdgeId(root: ParentNode, edgeId: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>("[data-edge-id]")].find(
    (item) => item.getAttribute("data-edge-id") === edgeId,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing edge id: ${edgeId}`);
  return button;
}

function inputByLabel(root: ParentNode, label: string): HTMLInputElement {
  const input = root.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input label: ${label}`);
  return input;
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
    settleReheatMock.mockClear();
    settleSetDragPinMock.mockClear();
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

  it("renders galaxy edges with the shared goal graph edge renderer", async () => {
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

    const edge = buttonByEdgeId(host, "tether:goal:g1->task:a");
    expect(host.querySelector("[data-rf='true']")?.getAttribute("data-edge-types")).toBe("goal-graph-edge");
    expect(edge.getAttribute("data-edge-type")).toBe("goal-graph-edge");
    expect(edge.getAttribute("data-edge-style-opacity")).toBe("0.05");
    expect(edge.getAttribute("data-edge-source-handle")).toBe("source-center");
    expect(edge.getAttribute("data-edge-target-handle")).toBe("target-center");
    await unmount(root);
  });

  it("renders connectable four-way member handles plus passive center handles for tethers", async () => {
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

    const memberHandles = [...host.querySelectorAll('[data-node-render-id="task:a"] [data-rf-handle="true"]')];
    const starHandles = [...host.querySelectorAll('[data-node-render-id="goal:g1"] [data-rf-handle="true"]')];

    expect(memberHandles).toHaveLength(10);
    expect(memberHandles.filter((handle) => handle.getAttribute("data-handle-connectable") === "true")).toHaveLength(8);
    expect(
      memberHandles
        .filter((handle) => handle.getAttribute("data-handle-connectable") === "false")
        .map((handle) => handle.getAttribute("data-handle-position"))
        .sort(),
    ).toEqual(["bottom", "top"]);
    expect(starHandles).toHaveLength(2);
    expect(starHandles.map((handle) => handle.getAttribute("data-handle-position")).sort()).toEqual(["bottom", "top"]);
    expect(starHandles.every((handle) => handle.getAttribute("data-handle-connectable") === "false")).toBe(true);
    await unmount(root);
  });

  it("uses the nearest side handles for prerequisite edges on the galaxy canvas", async () => {
    const firstRef = { kind: "task" as const, id: "a" };
    const secondRef = { kind: "task" as const, id: "b" };
    const goalValue = goal({
      members: [firstRef, secondRef],
      prerequisites: [{ blocker: firstRef, blocked: secondRef }],
    });
    const layoutPins: GoalLayoutPin[] = [
      { goalId: "g1", nodeKind: "goal", nodeId: "g1", x: 0, y: 0, updatedAt: "2026-01-01T00:00:00.000Z" },
      { goalId: "g1", nodeKind: "task", nodeId: "a", x: -120, y: 0, updatedAt: "2026-01-01T00:00:00.000Z" },
      { goalId: "g1", nodeKind: "task", nodeId: "b", x: 120, y: 0, updatedAt: "2026-01-01T00:00:00.000Z" },
    ];

    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a", { title: "A" }), task("b", { title: "B" })]}
        tracks={[]}
        steps={[]}
        layoutPins={layoutPins}
        onNavigate={vi.fn()}
      />,
    );

    const edge = buttonByEdgeId(host, "prerequisite:g1:task:a->task:b");
    expect(edge.getAttribute("data-edge-source-handle")).toBe("source-right");
    expect(edge.getAttribute("data-edge-target-handle")).toBe("target-left");
    await unmount(root);
  });

  it("lets the user adjust goal membership tether opacity without dimming prerequisites", async () => {
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

    const slider = inputByLabel(host, "归属线透明度");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(slider, "0");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(buttonByEdgeId(host, "tether:goal:g1->task:a").getAttribute("data-edge-style-opacity")).toBe("0");
    expect(buttonByEdgeId(host, "prerequisite:g1:task:a->task:b").getAttribute("data-edge-style-opacity")).toBe("");
    await unmount(root);
  });

  it("keeps dragged nodes moving locally before the pin live query refreshes", async () => {
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
    const member = () => host.querySelector('[data-node-id="task:a"]');
    const startX = Number(member()?.getAttribute("data-node-x"));
    const startY = Number(member()?.getAttribute("data-node-y"));

    await click(host.querySelector('[data-rf-drag-node-id="task:a"]'));

    expect(member()?.getAttribute("data-node-x")).toBe(String(startX + 10));
    expect(member()?.getAttribute("data-node-y")).toBe(String(startY + 20));
    await unmount(root);
  });

  it("keeps a dragged local member position when selecting the node rerenders the canvas", async () => {
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
    const member = () => host.querySelector('[data-node-id="task:a"]');
    const startX = Number(member()?.getAttribute("data-node-x"));
    const startY = Number(member()?.getAttribute("data-node-y"));

    await click(host.querySelector('[data-rf-drag-node-id="task:a"]'));
    await click(member());

    expect(member()?.getAttribute("data-node-x")).toBe(String(startX + 10));
    expect(member()?.getAttribute("data-node-y")).toBe(String(startY + 20));
    await unmount(root);
  });

  it("moves a single-goal member with its goal star while dragging", async () => {
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
    const star = () => host.querySelector('[data-node-id="goal:g1"]');
    const member = () => host.querySelector('[data-node-id="task:a"]');
    const starStartX = Number(star()?.getAttribute("data-node-x"));
    const starStartY = Number(star()?.getAttribute("data-node-y"));
    const memberStartX = Number(member()?.getAttribute("data-node-x"));
    const memberStartY = Number(member()?.getAttribute("data-node-y"));

    await click(host.querySelector('[data-rf-drag-node-id="goal:g1"]'));

    expect(star()?.getAttribute("data-node-x")).toBe(String(starStartX + 10));
    expect(star()?.getAttribute("data-node-y")).toBe(String(starStartY + 20));
    expect(member()?.getAttribute("data-node-x")).toBe(String(memberStartX + 10));
    expect(member()?.getAttribute("data-node-y")).toBe(String(memberStartY + 20));
    await unmount(root);
  });

  it("moves a goal cluster from React Flow position changes during drag", async () => {
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
    const star = () => host.querySelector('[data-node-id="goal:g1"]');
    const member = () => host.querySelector('[data-node-id="task:a"]');
    const starStartX = Number(star()?.getAttribute("data-node-x"));
    const starStartY = Number(star()?.getAttribute("data-node-y"));
    const memberStartX = Number(member()?.getAttribute("data-node-x"));
    const memberStartY = Number(member()?.getAttribute("data-node-y"));

    await act(async () => {
      getReactFlowMock().fireNodesChange([
        { id: "goal:g1", type: "position", position: { x: starStartX + 10, y: starStartY + 20 } },
      ]);
    });

    expect(star()?.getAttribute("data-node-x")).toBe(String(starStartX + 10));
    expect(star()?.getAttribute("data-node-y")).toBe(String(starStartY + 20));
    expect(member()?.getAttribute("data-node-x")).toBe(String(memberStartX + 10));
    expect(member()?.getAttribute("data-node-y")).toBe(String(memberStartY + 20));
    await unmount(root);
  });

  it("continues dragging a goal cluster from the latest local position", async () => {
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
    const star = () => host.querySelector('[data-node-id="goal:g1"]');
    const member = () => host.querySelector('[data-node-id="task:a"]');
    const starStartX = Number(star()?.getAttribute("data-node-x"));
    const starStartY = Number(star()?.getAttribute("data-node-y"));
    const memberStartX = Number(member()?.getAttribute("data-node-x"));
    const memberStartY = Number(member()?.getAttribute("data-node-y"));

    await act(async () => {
      getReactFlowMock().fireNodesChange([
        { id: "goal:g1", type: "position", position: { x: starStartX + 10, y: starStartY + 20 } },
      ]);
    });
    await act(async () => {
      getReactFlowMock().fireNodesChange([
        { id: "goal:g1", type: "position", position: { x: starStartX + 15, y: starStartY + 25 } },
      ]);
    });

    expect(star()?.getAttribute("data-node-x")).toBe(String(starStartX + 15));
    expect(star()?.getAttribute("data-node-y")).toBe(String(starStartY + 25));
    expect(member()?.getAttribute("data-node-x")).toBe(String(memberStartX + 15));
    expect(member()?.getAttribute("data-node-y")).toBe(String(memberStartY + 25));
    await unmount(root);
  });

  it("offers a fit-view control on the galaxy canvas", async () => {
    resetReactFlowMock();
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal()]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );
    getReactFlowMock().fitView.mockClear();

    await click(buttonByLabel(host, "回到全图"));

    expect(getReactFlowMock().fitView).toHaveBeenCalledWith({ padding: 0.2 });
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

  it("restores a pinned goal star from the pin button", async () => {
    const layoutPins: GoalLayoutPin[] = [
      { goalId: "g1", nodeKind: "goal", nodeId: "g1", x: 100, y: 100, updatedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goal()]}
        tasks={[]}
        tracks={[]}
        steps={[]}
        layoutPins={layoutPins}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-star-id="goal:g1"] button[aria-label="恢复自动布局"]'));
    await flushPromises();

    expect(deleteGoalLayoutPinMock).toHaveBeenCalledWith({ goalId: "g1", nodeKind: "goal", nodeId: "g1" });
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

    expect(host.querySelectorAll('[aria-label="恢复自动布局"]')).toHaveLength(2);
    await unmount(root);
  });

  it("does not show a pinned badge or restore action for bridge members with scoped member pins", async () => {
    const goals = [
      goal({ id: "g1", title: "G1", members: [{ kind: "task", id: "a" }] }),
      goal({ id: "g2", title: "G2", members: [{ kind: "task", id: "a" }] }),
    ];
    const layoutPins: GoalLayoutPin[] = [
      { goalId: "g1", nodeKind: "task", nodeId: "a", x: 30, y: -10, updatedAt: "2026-01-01T00:00:00.000Z" },
    ];

    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={goals}
        tasks={[task("a", { title: "A" })]}
        tracks={[]}
        steps={[]}
        layoutPins={layoutPins}
        onNavigate={vi.fn()}
      />,
    );

    expect(host.querySelector('[aria-label="已固定位置"]')).toBeNull();
    await click(host.querySelector('[data-node-id="task:a"]'));
    expect(document.body.querySelector('button[aria-label="恢复自动 A"]')).toBeNull();
    await unmount(root);
  });

  it("restoreGalaxyPin deletes the selected node pin and syncs after write", async () => {
    await restoreGalaxyPin({
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

  it("runs restore-auto from a selected pinned member action", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const layoutPins: GoalLayoutPin[] = [
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

    await click(host.querySelector('[data-node-id="task:a"]'));
    await click(buttonByLabel(document.body, "恢复自动 A"));
    await flushPromises();

    expect(deleteGoalLayoutPinMock).toHaveBeenCalledWith({ goalId: "g1", nodeKind: "task", nodeId: "a" });
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("connects two single-goal members on the galaxy canvas", async () => {
    const firstRef = { kind: "task" as const, id: "t1" };
    const secondRef = { kind: "task" as const, id: "t2" };
    const goalValue = goal({ members: [firstRef, secondRef] });

    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("t1"), task("t2")]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );
    getReactFlowMock().setNextConnection({ source: "task:t1", target: "task:t2" });

    await click(host.querySelector("[data-rf-connect='true']"));
    await flushPromises();

    expect(updateGoalPrerequisitesMock).toHaveBeenCalledWith("g1", [{ blocker: firstRef, blocked: secondRef }]);
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
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

  it("opens task and track sources from selected member actions", async () => {
    const onNavigate = vi.fn();
    const goalValue = goal({
      members: [
        { kind: "task", id: "a" },
        { kind: "track", id: "t1" },
      ],
    });
    const track = {
      id: "t1",
      title: "轨道",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as const;
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a", { title: "A" })]}
        tracks={[track]}
        steps={[]}
        layoutPins={[]}
        onNavigate={onNavigate}
      />,
    );

    await click(host.querySelector('[data-node-id="task:a"]'));
    await click(buttonByLabel(document.body, "打开 A"));
    await click(host.querySelector('[data-node-id="track:t1"]'));
    await click(buttonByLabel(document.body, "打开 轨道"));

    expect(onNavigate).toHaveBeenCalledWith("/todo?taskId=a");
    expect(onNavigate).toHaveBeenCalledWith("/tracks/t1");
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
    await click(
      [...document.body.querySelectorAll("button")].filter((button) => button.textContent === "移除成员").at(-1),
    );
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

  it("deletes a selected prerequisite edge when member ids contain edge separators", async () => {
    const firstRef = { kind: "task" as const, id: "a:1" };
    const secondRef = { kind: "task" as const, id: "b->2" };
    const goalValue = goal({
      members: [firstRef, secondRef],
      prerequisites: [{ blocker: firstRef, blocked: secondRef }],
    });
    const edgeId = "prerequisite:g1:task:a:1->task:b->2";
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a:1", { title: "A" }), task("b->2", { title: "B" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(buttonByEdgeId(host, edgeId));
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

  it("quick-creates a task member from a selected goal star", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goal({ members: [] })]}
        tasks={[]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-node-id="goal:g1"]'));
    await click(buttonByLabel(document.body, "添加成员 G1"));
    const input = document.body.querySelector('input[aria-label="新建任务并加入"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing quick create input");
    await setInputValue(input, "  新任务  ");
    await click(buttonByText(document.body, "加入"));
    await flushPromises();

    expect(addTaskForGoalMock).toHaveBeenCalledWith("g1", { title: "新任务", toInbox: false });
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("edits archives and deletes a selected goal star from the goal menu", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goal({ title: "G1" })]}
        tasks={[]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
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

  it("archives a selected goal star directly from the action bar", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goal({ title: "G1" })]}
        tasks={[]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await click(host.querySelector('[data-node-id="goal:g1"]'));
    await click(buttonByLabel(document.body, "归档目标 G1"));
    await flushPromises();

    expect(updateGoalMock).toHaveBeenCalledWith("g1", { status: "archived" });
    expect(syncAfterWriteMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("confirms before deleting a selected goal star from the action bar", async () => {
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goal({ title: "G1" })]}
        tasks={[]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
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

  it("routes bridge member connect action to the selected focused editor", async () => {
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
    await click(buttonByLabel(document.body, "连前置 A"));
    await click(buttonByLabel(document.body, "在 G1 中编辑"));

    expect(updateGoalPrerequisitesMock).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("/goals/g1");
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
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a")]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
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
        <GoalGalaxyCanvas
          goals={[goalValue]}
          tasks={[task("a")]}
          tracks={[]}
          steps={[]}
          layoutPins={[]}
          onNavigate={vi.fn()}
        />,
      );
    });

    const counts = getReactFlowMock().fitViewRenderedNodeCounts;
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(2);
    await unmount(root);
  });

  it("keeps expanded clusters expanded while zoom remains inside the hysteresis band", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a")]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );
    expect(host.querySelector('[data-node-id="task:a"]')).toBeTruthy();

    await act(async () => {
      getReactFlowMock().fireMoveEnd({ x: 0, y: 0, zoom: 0.84 });
    });

    expect(host.querySelector('[data-node-id="task:a"]')).toBeTruthy();
    await unmount(root);
  });

  it("keeps collapsed cluster topology visible while hiding member labels", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a")]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );

    await act(async () => {
      getReactFlowMock().fireMoveEnd({ x: 0, y: 0, zoom: 0.2 });
    });

    expect(host.querySelector('[data-node-id="task:a"]')).toBeTruthy();
    expect(host.querySelector('[data-node-render-id="task:a"] [data-goal-graph-node-shape="true"]')).toBeTruthy();
    expect(host.querySelector('[data-node-render-id="task:a"] [data-goal-graph-node-label="true"]')).toBeNull();
    expect(buttonByEdgeId(host, "tether:goal:g1->task:a")).toBeInstanceOf(HTMLButtonElement);
    expect(host.querySelector('[data-star-id="goal:g1"]')?.getAttribute("data-star-lod")).toBe("collapsed");
    expect(host.querySelector('[data-star-id="goal:g1"] [data-star-title="true"]')?.className).toContain("sr-only");
    expect(host.querySelector('[data-star-id="goal:g1"] [data-star-member-count="true"]')?.className).toContain(
      "sr-only",
    );
    await unmount(root);
  });

  it("keeps per-goal member pins separate when the same member has pins under multiple goals", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "a" }] });
    const layoutPins: GoalLayoutPin[] = [
      { goalId: "g1", nodeKind: "task", nodeId: "a", x: 40, y: 10, updatedAt: "2026-01-01T00:00:00.000Z" },
      { goalId: "other", nodeKind: "task", nodeId: "a", x: 400, y: 400, updatedAt: "2026-01-01T00:00:00.000Z" },
    ];

    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[goalValue]}
        tasks={[task("a")]}
        tracks={[]}
        steps={[]}
        layoutPins={layoutPins}
        onNavigate={vi.fn()}
      />,
    );

    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-x")).toBe("40");
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-y")).toBe("10");
    await unmount(root);
  });

  it("shows the engine toggle defaulting to the deterministic label", async () => {
    localStorage.clear();
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal()]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );

    expect(buttonByLabel(host, "切换星图引擎")).toBeInstanceOf(HTMLButtonElement);
    expect(host.querySelector('[aria-label="重新整理"]')).toBeNull();
    await unmount(root);
  });

  it("switches the engine toggle to settle mode and reveals the live settling control", async () => {
    localStorage.clear();
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal()]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );

    await click(buttonByLabel(host, "切换星图引擎"));

    expect(localStorage.getItem("timedata_galaxy_engine")).toBe("settle");
    expect(buttonByLabel(host, "暂停持续整理")).toBeInstanceOf(HTMLButtonElement);
    await unmount(root);
  });

  it("adds the lively decoration class to stars only in settle mode", async () => {
    localStorage.setItem("timedata_galaxy_engine", "settle");
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal()]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );

    expect(host.querySelector('[data-star-id="goal:g1"][data-galaxy-lively="true"]')).toBeTruthy();
    await unmount(root);
    localStorage.clear();
  });

  it("reconciles node data and membership while settle mode keeps current positions", async () => {
    localStorage.setItem("timedata_galaxy_engine", "settle");
    const firstGoal = goal({ members: [{ kind: "task", id: "a" }] });
    const { host, root } = await renderDom(
      <GoalGalaxyCanvas
        goals={[firstGoal]}
        tasks={[task("a", { title: "A" })]}
        tracks={[]}
        steps={[]}
        layoutPins={[]}
        onNavigate={vi.fn()}
      />,
    );
    const settledPosition = { x: 321, y: 123 };
    act(() => {
      getReactFlowMock().fireNodesChange([{ id: "task:a", type: "position", position: settledPosition }]);
    });

    await act(async () => {
      root.render(
        <GoalGalaxyCanvas
          goals={[goal({ members: [{ kind: "task", id: "a" }, { kind: "task", id: "b" }] })]}
          tasks={[task("a", { title: "A updated" }), task("b", { title: "B" })]}
          tracks={[]}
          steps={[]}
          layoutPins={[]}
          onNavigate={vi.fn()}
        />,
      );
    });

    expect(host.querySelector('[data-node-id="task:a"]')?.textContent).toBe("A updated");
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-x")).toBe(String(settledPosition.x));
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-y")).toBe(String(settledPosition.y));
    expect(host.querySelector('[data-node-id="task:b"]')).toBeTruthy();
    await unmount(root);
    localStorage.clear();
  });

  it("drops settle positions when switching back to the deterministic engine", async () => {
    localStorage.clear();
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

    await click(buttonByLabel(host, "切换星图引擎"));
    expect(localStorage.getItem("timedata_galaxy_engine")).toBe("settle");

    act(() => {
      getReactFlowMock().fireNodesChange([{ id: "task:a", type: "position", position: { x: 333, y: 222 } }]);
    });

    await click(buttonByLabel(host, "切换星图引擎"));

    expect(localStorage.getItem("timedata_galaxy_engine")).toBe("deterministic");
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-x")).not.toBe("333");
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-y")).not.toBe("222");
    await unmount(root);
    localStorage.clear();
  });

  it("keeps goal members pinned with the star while dragging in settle mode", async () => {
    localStorage.setItem("timedata_galaxy_engine", "settle");
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
    settleSetDragPinMock.mockClear();
    const goalButton = host.querySelector('[data-node-id="goal:g1"]');
    const taskButton = host.querySelector('[data-node-id="task:a"]');
    const goalX = Number(goalButton?.getAttribute("data-node-x"));
    const goalY = Number(goalButton?.getAttribute("data-node-y"));
    const taskX = Number(taskButton?.getAttribute("data-node-x"));
    const taskY = Number(taskButton?.getAttribute("data-node-y"));

    act(() => {
      getReactFlowMock().fireNodesChange([
        { id: "goal:g1", type: "position", position: { x: goalX + 40, y: goalY + 30 } },
      ]);
    });

    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-x")).toBe(String(taskX + 40));
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-y")).toBe(String(taskY + 30));
    expect(settleSetDragPinMock).toHaveBeenCalledWith("goal:g1", { x: goalX + 40, y: goalY + 30 });
    expect(settleSetDragPinMock).toHaveBeenCalledWith("task:a", { x: taskX + 40, y: taskY + 30 });
    await unmount(root);
    localStorage.clear();
  });

  it("does not persist layout pins when dragging in settle mode", async () => {
    localStorage.setItem("timedata_galaxy_engine", "settle");
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

    await click(host.querySelector('[data-rf-drag-stop-node-id="task:a"]'));

    expect(upsertGoalLayoutPinMock).not.toHaveBeenCalled();
    await unmount(root);
    localStorage.clear();
  });
});
