import { describe, expect, it } from "vitest";
import type { GoalGraphEdge, GoalGraphNode } from "../../lib/goalGraphModel.js";
import { actionsForEdge, actionsForNode } from "./goalGraphActions.js";

function node(overrides: Partial<GoalGraphNode> & Pick<GoalGraphNode, "kind" | "status">): GoalGraphNode {
  return {
    id: `${overrides.kind}:1`,
    kind: overrides.kind,
    status: overrides.status,
    title: "节点",
    ref: overrides.kind === "goal" ? null : { kind: overrides.kind === "track" ? "track" : "task", id: "1" },
    hasDependency: false,
    ...overrides,
  };
}

function edge(kind: GoalGraphEdge["kind"]): GoalGraphEdge {
  return {
    id: `${kind}:a->b`,
    kind,
    source: "a",
    target: "b",
  };
}

describe("goalGraphActions", () => {
  it("returns task node actions with completion label from status", () => {
    expect(actionsForNode(node({ kind: "task", status: "ready" }))).toEqual([
      { id: "open", label: "打开", tone: "primary" },
      { id: "toggle-complete", label: "完成", tone: "default" },
      { id: "connect", label: "连前置", tone: "default" },
      { id: "remove-member", label: "移除成员", tone: "danger" },
    ]);

    expect(actionsForNode(node({ kind: "task", status: "completed" })).find((action) => action.id === "toggle-complete")).toEqual({
      id: "toggle-complete",
      label: "取消完成",
      tone: "default",
    });
  });

  it("returns track node actions without task completion", () => {
    expect(actionsForNode(node({ kind: "track", status: "active" }))).toEqual([
      { id: "open", label: "打开", tone: "primary" },
      { id: "connect", label: "连前置", tone: "default" },
      { id: "remove-member", label: "移除成员", tone: "danger" },
    ]);
  });

  it("returns ghost and goal node actions without connect", () => {
    expect(actionsForNode(node({ kind: "ghost", status: "ghost" }))).toEqual([
      { id: "remove-ref", label: "移除引用", tone: "danger" },
    ]);

    expect(actionsForNode(node({ kind: "goal", status: "anchor" }))).toEqual([
      { id: "add-member", label: "添加成员", tone: "primary" },
      { id: "edit-goal", label: "编辑目标", tone: "primary" },
      { id: "toggle-archive", label: "归档目标", tone: "default" },
      { id: "delete-goal", label: "删除目标", tone: "danger" },
    ]);

    expect(actionsForNode(node({ kind: "goal", status: "anchor" }), { archived: true }).find((action) => action.id === "toggle-archive")).toEqual({
      id: "toggle-archive",
      label: "恢复目标",
      tone: "default",
    });
  });

  it("returns edge actions for prerequisite edges only", () => {
    expect(actionsForEdge(edge("prerequisite"))).toEqual([{ id: "delete-prerequisite", label: "删除前置", tone: "danger" }]);
    expect(actionsForEdge(edge("broken-prerequisite"))).toEqual([
      { id: "delete-prerequisite", label: "删除失效前置", tone: "danger" },
    ]);
    expect(actionsForEdge(edge("tether"))).toEqual([]);
  });
});
