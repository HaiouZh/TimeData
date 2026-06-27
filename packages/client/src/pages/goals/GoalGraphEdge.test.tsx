// @vitest-environment jsdom
import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { GoalGraphEdge } from "./GoalGraphEdge.js";

const baseProps = {
  id: "prerequisite:g1:task:a->task:b",
  sourceX: 0,
  sourceY: 0,
  targetX: 120,
  targetY: 20,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  source: "task:a",
  target: "task:b",
  sourceHandleId: null,
  targetHandleId: null,
  selected: false,
  animated: false,
  hidden: false,
  deletable: true,
  focusable: true,
  markerEnd: undefined,
  markerStart: undefined,
  interactionWidth: 20,
} as const;

describe("GoalGraphEdge", () => {
  it("renders prerequisite halo, arrow, base and flow inside one opacity group using galaxy tokens", async () => {
    const { host, root } = await renderDom(
      <svg>
        <GoalGraphEdge {...baseProps} data={{ kind: "prerequisite", opacity: 0.42 }} />
      </svg>,
    );

    const group = host.querySelector('[data-goal-edge-layer="prerequisite"]');
    expect(group?.getAttribute("opacity")).toBe("0.42");
    expect(host.querySelector("marker path")?.getAttribute("fill")).toBe("var(--galaxy-edge)");
    expect(host.querySelector('[data-goal-edge-halo="true"]')?.getAttribute("stroke")).toBe(
      "var(--galaxy-edge-glow)",
    );
    expect(host.querySelector(".goal-edge-flow")?.getAttribute("stroke")).toBe("var(--galaxy-edge)");

    await unmount(root);
  });

  it("defaults prerequisite opacity to 1 when no edge data opacity is supplied", async () => {
    const { host, root } = await renderDom(
      <svg>
        <GoalGraphEdge {...baseProps} data={{ kind: "prerequisite" }} />
      </svg>,
    );

    expect(host.querySelector('[data-goal-edge-layer="prerequisite"]')?.getAttribute("opacity")).toBe("1");
    await unmount(root);
  });

  it("does not wrap tether edges in the prerequisite opacity layer", async () => {
    const { host, root } = await renderDom(
      <svg>
        <GoalGraphEdge {...baseProps} id="tether:goal:g1->task:a" data={{ kind: "tether", opacity: 0.2 }} />
      </svg>,
    );

    expect(host.querySelector('[data-goal-edge-layer="prerequisite"]')).toBeNull();
    await unmount(root);
  });
});
