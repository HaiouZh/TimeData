// @vitest-environment jsdom
import type { Goal } from "@timedata/shared";
import { describe, expect, it, vi } from "vitest";
import { doubleClick, renderDom, unmount } from "../../test/domHarness.js";

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

describe("GoalGalaxyCanvas", () => {
  it("renders one star for each active goal and keeps the canvas read-only", async () => {
    const onNavigate = vi.fn();

    const { host, root } = await renderDom(
      <GoalGalaxyCanvas goals={[goal()]} tasks={[]} tracks={[]} steps={[]} layoutPins={[]} onNavigate={onNavigate} />,
    );

    const star = host.querySelector('[data-star-id="goal:g1"]');
    expect(host.querySelector("[data-galaxy]")).toBeTruthy();
    expect(star).toBeTruthy();
    expect(host.querySelector("[data-rf='true']")?.getAttribute("data-nodes-draggable")).toBe("false");

    await doubleClick(host.querySelector('[data-node-id="goal:g1"]'));
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
});
