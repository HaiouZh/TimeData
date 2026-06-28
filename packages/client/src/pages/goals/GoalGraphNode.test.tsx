// @vitest-environment jsdom
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import type { GoalGraphNode as GoalGraphNodeModel } from "../../lib/goalGraphModel.js";

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));

const { GoalGraphNode } = await import("./GoalGraphNode.js");

const GraphNode = GoalGraphNode as ComponentType<Record<string, unknown>>;

function node(overrides: Partial<GoalGraphNodeModel> = {}): GoalGraphNodeModel {
  return {
    id: "task:t1",
    kind: "task",
    status: "ready",
    title: "任务一",
    ref: { kind: "task", id: "t1" },
    hasDependency: false,
    ...overrides,
  };
}

describe("GoalGraphNode", () => {
  it("renders four-way handles with low visual presence until hover or selection", async () => {
    const { host, root } = await renderDom(
      <GraphNode
        data={{ node: node(), orientation: "horizontal", pinned: false }}
        selected={false}
        isConnectable
      />,
    );

    const handles = [...host.querySelectorAll("[data-rf-handle='true']")];
    expect(handles).toHaveLength(10);
    expect(handles.map((handle) => handle.getAttribute("data-handle-position")).sort()).toEqual([
      "bottom",
      "bottom",
      "bottom",
      "left",
      "left",
      "right",
      "right",
      "top",
      "top",
      "top",
    ]);
    expect(handles[0].className).toContain("!opacity-0");
    expect(handles[0].className).toContain("group-hover/goal-node:!opacity-60");
    await unmount(root);

    const selected = await renderDom(
      <GraphNode data={{ node: node(), orientation: "horizontal", pinned: false }} selected isConnectable />,
    );
    expect(selected.host.querySelector("[data-rf-handle='true']")?.className).toContain("!opacity-70");
    await unmount(selected.root);
  });

  it("可连节点渲染 center 锚点 handle", async () => {
    const { host, root } = await renderDom(
      <GraphNode data={{ node: node(), orientation: "horizontal", pinned: false }} selected={false} isConnectable />,
    );
    expect(host.querySelector('[data-handleid="source-center"]')).not.toBeNull();
    expect(host.querySelector('[data-handleid="target-center"]')).not.toBeNull();
    await unmount(root);
  });
});
