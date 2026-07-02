// @vitest-environment jsdom

import type { Goal, Task } from "@timedata/shared";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";

const upsertGoalLayoutPinMock = vi.hoisted(() => vi.fn());
const deleteGoalLayoutPinMock = vi.hoisted(() => vi.fn());
const toggleTaskDoneMock = vi.hoisted(() => vi.fn());
const removeGoalMemberMock = vi.hoisted(() => vi.fn());
const updateGoalPrerequisitesMock = vi.hoisted(() => vi.fn());
const addGoalMemberMock = vi.hoisted(() => vi.fn());
const addTaskForGoalMock = vi.hoisted(() => vi.fn());
const updateGoalMock = vi.hoisted(() => vi.fn());
const deleteGoalMock = vi.hoisted(() => vi.fn());
const tickMock = vi.hoisted(() => vi.fn(() => ({ alpha: 0.001, positions: { "task:a": { x: 111, y: 222 } } })));
const stopMock = vi.hoisted(() => vi.fn());
const isSettledMock = vi.hoisted(() => vi.fn(() => true));
const reheatMock = vi.hoisted(() => vi.fn());
const setLiveMock = vi.hoisted(() => vi.fn());
const syncModelMock = vi.hoisted(() => vi.fn());
const setDragPinMock = vi.hoisted(() => vi.fn());
const createSettleSimMock = vi.hoisted(() =>
  vi.fn(() => ({
    tick: tickMock,
    stop: stopMock,
    isSettled: isSettledMock,
    reheat: reheatMock,
    setLive: setLiveMock,
    syncModel: syncModelMock,
    setDragPin: setDragPinMock,
  })),
);

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));
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
vi.mock("../../lib/goalGalaxySettle.js", () => ({
  createGalaxySettleSim: createSettleSimMock,
  SETTLE_ALPHA_MIN: 0.02,
}));

const { GoalGalaxyCanvas } = await import("./GoalGalaxyCanvas.js");

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

let frame: FrameRequestCallback | null = null;

async function flushImport(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushFrame(): Promise<void> {
  const callback = frame;
  frame = null;
  await act(async () => {
    callback?.(0);
  });
}

function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const button = root.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button label: ${label}`);
  return button;
}

describe("GoalGalaxyCanvas settle integration", () => {
  beforeEach(() => {
    localStorage.clear();
    createSettleSimMock.mockClear();
    tickMock.mockClear();
    stopMock.mockClear();
    isSettledMock.mockClear();
    reheatMock.mockClear();
    setLiveMock.mockClear();
    syncModelMock.mockClear();
    setDragPinMock.mockClear();
    frame = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("does not create the settle simulation while the deterministic engine is active", async () => {
    const { root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal()]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={vi.fn()} />,
    );
    await flushImport();

    expect(createSettleSimMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("connects settle ticks, reheat, and model sync through the real hook", async () => {
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

    await flushImport();
    await flushFrame();

    expect(createSettleSimMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-x")).toBe("111");
    expect(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-y")).toBe("222");

    await click(buttonByLabel(host, "暂停持续整理"));
    expect(buttonByLabel(host, "继续持续整理")).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      root.render(
        <GoalGalaxyCanvas
          goals={[goal({ members: [{ kind: "task", id: "a" }, { kind: "task", id: "b" }] })]}
          tasks={[task("a", { title: "A" }), task("b", { title: "B" })]}
          tracks={[]}
          steps={[]}
          layoutPins={[]}
          onNavigate={vi.fn()}
        />,
      );
    });

    expect(syncModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ id: "task:b" })]),
      }),
    );
    await unmount(root);
  });

  it("passes the currently rendered static positions as the first settle seeds", async () => {
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
    const staticX = Number(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-x"));
    const staticY = Number(host.querySelector('[data-node-id="task:a"]')?.getAttribute("data-node-y"));

    await flushImport();

    const firstInput = createSettleSimMock.mock.calls[0]?.[0] as
      | { nodes?: Array<{ id: string; seed: { x: number; y: number } }> }
      | undefined;
    const taskSeed = firstInput?.nodes?.find((node) => node.id === "task:a")?.seed;
    expect(taskSeed).toEqual({ x: staticX, y: staticY });
    await unmount(root);
  });
});
