// @vitest-environment jsdom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Goal, GoalLayoutPin } from "@timedata/shared";
import type { GoalGraphModel } from "../../lib/goalGraphModel.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import type { GoalLayoutController } from "./useGoalGraphLayout.js";

const { deleteGoalLayoutPinMock, settleGoalLayoutMock, upsertGoalLayoutPinMock } = vi.hoisted(() => ({
  deleteGoalLayoutPinMock: vi.fn(() => Promise.resolve()),
  settleGoalLayoutMock: vi.fn(),
  upsertGoalLayoutPinMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../lib/goalForceSim.js", () => ({
  settleGoalLayout: settleGoalLayoutMock,
}));

vi.mock("../../lib/goalLayoutPins.js", () => ({
  deleteGoalLayoutPin: deleteGoalLayoutPinMock,
  upsertGoalLayoutPin: upsertGoalLayoutPinMock,
}));

const { useGoalGraphLayout } = await import("./useGoalGraphLayout.js");

const now = "2026-06-25T00:00:00.000Z";

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

const model: GoalGraphModel = {
  goalNodeId: "goal",
  nodes: [
    { id: "goal", kind: "goal", status: "anchor", title: "Goal", ref: null, hasDependency: false },
    {
      id: "task:task-1",
      kind: "task",
      status: "ready",
      title: "A",
      ref: { kind: "task", id: "task-1" },
      hasDependency: true,
    },
    {
      id: "task:task-2",
      kind: "task",
      status: "ready",
      title: "B",
      ref: { kind: "task", id: "task-2" },
      hasDependency: true,
    },
  ],
  edges: [
    { id: "tether:goal->task:task-1", kind: "tether", source: "goal", target: "task:task-1" },
    { id: "tether:goal->task:task-2", kind: "tether", source: "goal", target: "task:task-2" },
    {
      id: "prerequisite:task:task-1->task:task-2",
      kind: "prerequisite",
      source: "task:task-1",
      target: "task:task-2",
    },
  ],
  summary: { ready: 2, blocked: 0, completed: 0 },
};

const overlappingModel: GoalGraphModel = {
  goalNodeId: "goal",
  nodes: [
    { id: "goal", kind: "goal", status: "anchor", title: "Goal", ref: null, hasDependency: false },
    {
      id: "task:task-1",
      kind: "task",
      status: "ready",
      title: "A",
      ref: { kind: "task", id: "task-1" },
      hasDependency: false,
    },
    {
      id: "task:task-2",
      kind: "task",
      status: "ready",
      title: "B",
      ref: { kind: "task", id: "task-2" },
      hasDependency: false,
    },
  ],
  edges: [
    { id: "tether:goal->task:task-1", kind: "tether", source: "goal", target: "task:task-1" },
    { id: "tether:goal->task:task-2", kind: "tether", source: "goal", target: "task:task-2" },
  ],
  summary: { ready: 2, blocked: 0, completed: 0 },
};

const visualBoxByKind = {
  goal: { width: 240, height: 80, offsetX: 0, offsetY: 0 },
  task: { width: 228, height: 48, offsetX: 94, offsetY: 0 },
  track: { width: 190, height: 56, offsetX: 0, offsetY: 0 },
  ghost: { width: 190, height: 56, offsetX: 0, offsetY: 0 },
} as const;

function visualRectFor(graphModel: GoalGraphModel, nodeId: string, position: { x: number; y: number }) {
  const node = graphModel.nodes.find((item) => item.id === nodeId);
  const box = visualBoxByKind[node?.kind ?? "task"];
  const centerX = position.x + box.offsetX;
  const centerY = position.y + box.offsetY;
  return {
    left: centerX - box.width / 2,
    right: centerX + box.width / 2,
    top: centerY - box.height / 2,
    bottom: centerY + box.height / 2,
  };
}

function visualRectsOverlap(
  graphModel: GoalGraphModel,
  leftId: string,
  leftPosition: { x: number; y: number },
  rightId: string,
  rightPosition: { x: number; y: number },
): boolean {
  const left = visualRectFor(graphModel, leftId, leftPosition);
  const right = visualRectFor(graphModel, rightId, rightPosition);
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

let latestLayout: GoalLayoutController | null = null;

function Probe({ layoutPins = [], graphModel = model }: { layoutPins?: GoalLayoutPin[]; graphModel?: GoalGraphModel }) {
  latestLayout = useGoalGraphLayout({
    goal: goal(),
    model: graphModel,
    orientation: "horizontal",
    layoutPins,
  });

  return createElement("span", { "data-probe": "true" });
}

describe("useGoalGraphLayout", () => {
  it("uses structured layout without running force simulation", async () => {
    settleGoalLayoutMock.mockClear();

    const { root } = await renderDom(createElement(Probe));

    expect(settleGoalLayoutMock).not.toHaveBeenCalled();
    expect(latestLayout?.positions.goal).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(latestLayout?.positions["task:task-1"].x ?? 0, latestLayout?.positions["task:task-1"].y ?? 0)).toBeGreaterThan(
      120,
    );
    expect(latestLayout?.positions["task:task-2"]).not.toEqual(latestLayout?.positions["task:task-1"]);
    await unmount(root);
  });

  it("pins a dragged member without moving other nodes", async () => {
    upsertGoalLayoutPinMock.mockClear();
    const { root } = await renderDom(createElement(Probe));
    const before = latestLayout?.positions;
    if (!before) throw new Error("missing layout");

    await act(async () => {
      latestLayout?.onNodeDragStop("task:task-1", { x: 500, y: 600 });
      await Promise.resolve();
    });

    expect(latestLayout?.positions["task:task-1"]).toEqual({ x: 500, y: 600 });
    expect(latestLayout?.positions["task:task-2"]).toEqual(before["task:task-2"]);
    expect(upsertGoalLayoutPinMock).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: "goal-1",
        nodeKind: "task",
        nodeId: "task-1",
        x: 500,
        y: 600,
      }),
    );
    await unmount(root);
  });

  it("nudges a dragged member away from overlaps before saving the pin", async () => {
    upsertGoalLayoutPinMock.mockClear();
    const { root } = await renderDom(createElement(Probe));
    const before = latestLayout?.positions;
    if (!before) throw new Error("missing layout");

    await act(async () => {
      latestLayout?.onNodeDragStop("task:task-1", before["task:task-2"]);
      await Promise.resolve();
    });

    expect(latestLayout?.positions["task:task-2"]).toEqual(before["task:task-2"]);
    expect(latestLayout?.positions["task:task-1"]).not.toEqual(before["task:task-2"]);
    expect(upsertGoalLayoutPinMock).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: "goal-1",
        nodeKind: "task",
        nodeId: "task-1",
        x: latestLayout?.positions["task:task-1"].x,
        y: latestLayout?.positions["task:task-1"].y,
      }),
    );
    await unmount(root);
  });

  it("finds the nearest free landing spot when the dragged member is dropped into a crowded cluster", async () => {
    upsertGoalLayoutPinMock.mockClear();
    const crowdedModel: GoalGraphModel = {
      goalNodeId: "goal",
      nodes: [
        { id: "goal", kind: "goal", status: "anchor", title: "Goal", ref: null, hasDependency: false },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `task:task-${index + 1}`,
          kind: "task" as const,
          status: "ready" as const,
          title: `Task ${index + 1}`,
          ref: { kind: "task" as const, id: `task-${index + 1}` },
          hasDependency: false,
        })),
      ],
      edges: [],
      summary: { ready: 6, blocked: 0, completed: 0 },
    };
    const { root } = await renderDom(
      createElement(Probe, {
        graphModel: crowdedModel,
        layoutPins: [
          { goalId: "goal-1", nodeKind: "task", nodeId: "task-2", x: 0, y: 0, updatedAt: now },
          { goalId: "goal-1", nodeKind: "task", nodeId: "task-3", x: 92, y: 0, updatedAt: now },
          { goalId: "goal-1", nodeKind: "task", nodeId: "task-4", x: -92, y: 0, updatedAt: now },
          { goalId: "goal-1", nodeKind: "task", nodeId: "task-5", x: 0, y: 84, updatedAt: now },
          { goalId: "goal-1", nodeKind: "task", nodeId: "task-6", x: 0, y: -84, updatedAt: now },
        ],
      }),
    );

    await act(async () => {
      latestLayout?.onNodeDragStop("task:task-1", { x: 0, y: 0 });
      await Promise.resolve();
    });

    const landed = latestLayout?.positions["task:task-1"];
    if (!landed) throw new Error("missing landed position");
    for (const [id, position] of Object.entries(latestLayout?.positions ?? {})) {
      if (id === "goal" || id === "task:task-1") continue;
      expect(visualRectsOverlap(crowdedModel, "task:task-1", landed, id, position), `${id} still overlaps`).toBe(false);
    }
    await unmount(root);
  });

  it("keeps a dragged task label out of nearby track boxes", async () => {
    upsertGoalLayoutPinMock.mockClear();
    const labelModel: GoalGraphModel = {
      goalNodeId: "goal",
      nodes: [
        { id: "goal", kind: "goal", status: "anchor", title: "Goal", ref: null, hasDependency: false },
        {
          id: "task:task-1",
          kind: "task",
          status: "ready",
          title: "一个很长很长的 ToDo 标题",
          ref: { kind: "task", id: "task-1" },
          hasDependency: false,
        },
        {
          id: "track:track-1",
          kind: "track",
          status: "active",
          title: "右侧轨道",
          ref: { kind: "track", id: "track-1" },
          hasDependency: false,
        },
      ],
      edges: [],
      summary: { ready: 1, blocked: 0, completed: 0 },
    };
    const { root } = await renderDom(
      createElement(Probe, {
        graphModel: labelModel,
        layoutPins: [{ goalId: "goal-1", nodeKind: "track", nodeId: "track-1", x: 260, y: 0, updatedAt: now }],
      }),
    );

    await act(async () => {
      latestLayout?.onNodeDragStop("task:task-1", { x: 0, y: 0 });
      await Promise.resolve();
    });

    const landed = latestLayout?.positions["task:task-1"];
    const trackPosition = latestLayout?.positions["track:track-1"];
    if (!landed || !trackPosition) throw new Error("missing positions");
    expect(visualRectsOverlap(labelModel, "task:task-1", landed, "track:track-1", trackPosition)).toBe(false);
    expect(Math.abs(landed.x)).toBeLessThan(96);
    await unmount(root);
  });

  it("only nudges a member by the minimum needed distance when it barely touches another node", async () => {
    const nearTouchModel: GoalGraphModel = {
      goalNodeId: "goal",
      nodes: [
        { id: "goal", kind: "goal", status: "anchor", title: "Goal", ref: null, hasDependency: false },
        {
          id: "track:left",
          kind: "track",
          status: "active",
          title: "左轨道",
          ref: { kind: "track", id: "left" },
          hasDependency: false,
        },
        {
          id: "track:right",
          kind: "track",
          status: "active",
          title: "右轨道",
          ref: { kind: "track", id: "right" },
          hasDependency: false,
        },
      ],
      edges: [],
      summary: { ready: 0, blocked: 0, completed: 0 },
    };
    const { root } = await renderDom(
      createElement(Probe, {
        graphModel: nearTouchModel,
        layoutPins: [
          { goalId: "goal-1", nodeKind: "goal", nodeId: "goal-1", x: 0, y: -400, updatedAt: now },
          { goalId: "goal-1", nodeKind: "track", nodeId: "right", x: 195, y: 400, updatedAt: now },
        ],
      }),
    );

    await act(async () => {
      latestLayout?.onNodeDragStop("track:left", { x: 0, y: 0 });
      await Promise.resolve();
    });

    const landed = latestLayout?.positions["track:left"];
    if (!landed) throw new Error("missing landed position");
    expect(landed.x).toBeLessThanOrEqual(-1);
    expect(landed.x).toBeGreaterThan(-12);
    await unmount(root);
  });

  it("resolves overlap between automatic nodes while keeping pinned nodes fixed", async () => {
    const { root } = await renderDom(
      createElement(Probe, {
        graphModel: overlappingModel,
        layoutPins: [
          { goalId: "goal-1", nodeKind: "task", nodeId: "task-1", x: 260, y: 0, updatedAt: now },
        ],
      }),
    );

    expect(latestLayout?.positions["task:task-1"]).toEqual({ x: 260, y: 0 });
    expect(Math.abs((latestLayout?.positions["task:task-2"].x ?? 0) - 260)).toBeGreaterThan(60);
    await unmount(root);
  });

  it("moves the whole graph when the goal anchor is dragged", async () => {
    const { root } = await renderDom(createElement(Probe));
    const before = latestLayout?.positions;
    if (!before) throw new Error("missing layout");

    await act(async () => {
      latestLayout?.onNodeDragStop("goal", { x: 100, y: 120 });
      await Promise.resolve();
    });

    expect(latestLayout?.positions.goal).toEqual({ x: 100, y: 120 });
    expect(latestLayout?.positions["task:task-1"]).toEqual({
      x: before["task:task-1"].x + 100,
      y: before["task:task-1"].y + 120,
    });
    expect(latestLayout?.positions["task:task-2"]).toEqual({
      x: before["task:task-2"].x + 100,
      y: before["task:task-2"].y + 120,
    });
    await unmount(root);
  });
});
