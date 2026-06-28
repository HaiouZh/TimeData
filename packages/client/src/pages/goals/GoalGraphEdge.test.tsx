// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { setMockNodeGeom, resetReactFlowMock } from "./test/reactFlowMock.js";

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));

const { GoalGraphEdge } = await import("./GoalGraphEdge.js");

const baseProps = {
  id: "prerequisite:g1:task:a->task:b",
  source: "task:a",
  target: "task:b",
  sourceX: 0,
  sourceY: 0,
  targetX: 300,
  targetY: 0,
  sourceHandleId: "source-center",
  targetHandleId: "target-center",
  selected: false,
  animated: false,
  hidden: false,
  deletable: true,
  focusable: true,
  markerEnd: undefined,
  markerStart: undefined,
  interactionWidth: 20,
} as const;

beforeEach(() => {
  resetReactFlowMock();
  setMockNodeGeom("task:a", { x: 0, y: 0, width: 120, height: 48 });
  setMockNodeGeom("task:b", { x: 300, y: 0, width: 120, height: 48 });
});

describe("GoalGraphEdge", () => {
  it("prerequisite 三层(halo/arrow/base/flow)用 galaxy token、套在同一 opacity 组", async () => {
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

  it("用两端真实几何画 floating path(端点落在边框上)", async () => {
    const { host, root } = await renderDom(
      <svg>
        <GoalGraphEdge {...baseProps} data={{ kind: "prerequisite" }} />
      </svg>,
    );
    const d = host.querySelector('[data-goal-edge-halo="true"]')?.getAttribute("d");
    expect(d?.startsWith("M60,0")).toBe(true); // source 右边框中点
    expect(d?.endsWith("240,0")).toBe(true); // target 左边框中点
    await unmount(root);
  });

  it("默认 opacity 为 1", async () => {
    const { host, root } = await renderDom(
      <svg>
        <GoalGraphEdge {...baseProps} data={{ kind: "prerequisite" }} />
      </svg>,
    );
    expect(host.querySelector('[data-goal-edge-layer="prerequisite"]')?.getAttribute("opacity")).toBe("1");
    await unmount(root);
  });

  it("tether 不套 prerequisite opacity 组", async () => {
    const { host, root } = await renderDom(
      <svg>
        <GoalGraphEdge {...baseProps} id="tether:goal:g1->task:a" data={{ kind: "tether", opacity: 0.2 }} />
      </svg>,
    );
    expect(host.querySelector('[data-goal-edge-layer="prerequisite"]')).toBeNull();
    await unmount(root);
  });
});