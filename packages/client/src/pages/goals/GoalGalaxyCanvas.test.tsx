// @vitest-environment jsdom
import { act } from "react";
import type { Goal, GoalLayoutPin, Task } from "@timedata/shared";
import { describe, expect, it, vi } from "vitest";
import { doubleClick, renderDom, unmount } from "../../test/domHarness.js";
import { getReactFlowMock, resetReactFlowMock } from "./test/reactFlowMock.js";

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));

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
    title: id,
    done: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Task;
}

describe("GoalGalaxyCanvas", () => {
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
