import type { GoalGraphEdge, GoalGraphNode } from "../../lib/goalGraphModel.js";

export type GoalActionId =
  | "open"
  | "add-member"
  | "toggle-complete"
  | "connect"
  | "restore-auto"
  | "remove-member"
  | "remove-ref"
  | "delete-prerequisite"
  | "edit-goal"
  | "toggle-archive"
  | "delete-goal";

export type GoalActionTone = "primary" | "default" | "danger";

export interface GoalAction {
  id: GoalActionId;
  label: string;
  tone: GoalActionTone;
}

interface GoalNodeActionOptions {
  archived?: boolean;
  pinned?: boolean;
}

const OPEN_ACTION: GoalAction = { id: "open", label: "打开", tone: "primary" };
const CONNECT_ACTION: GoalAction = { id: "connect", label: "连前置", tone: "default" };
const RESTORE_AUTO_ACTION: GoalAction = { id: "restore-auto", label: "恢复自动", tone: "default" };
const REMOVE_MEMBER_ACTION: GoalAction = { id: "remove-member", label: "移除成员", tone: "danger" };
const REMOVE_REF_ACTION: GoalAction = { id: "remove-ref", label: "移除引用", tone: "danger" };
const DELETE_PREREQUISITE_ACTION: GoalAction = { id: "delete-prerequisite", label: "删除前置", tone: "danger" };
const EDIT_GOAL_ACTION: GoalAction = { id: "edit-goal", label: "编辑目标", tone: "primary" };
const DELETE_GOAL_ACTION: GoalAction = { id: "delete-goal", label: "删除目标", tone: "danger" };

function toggleCompleteAction(node: GoalGraphNode): GoalAction {
  return {
    id: "toggle-complete",
    label: node.status === "completed" ? "取消完成" : "完成",
    tone: "default",
  };
}

function toggleArchiveAction(options: GoalNodeActionOptions): GoalAction {
  return {
    id: "toggle-archive",
    label: options.archived ? "恢复目标" : "归档目标",
    tone: "default",
  };
}

function withRestoreAuto(actions: GoalAction[], node: GoalGraphNode, options: GoalNodeActionOptions): GoalAction[] {
  if (!options.pinned || node.kind === "ghost") return actions;
  return [...actions, RESTORE_AUTO_ACTION];
}

export function actionsForNode(node: GoalGraphNode, options: GoalNodeActionOptions = {}): GoalAction[] {
  if (node.kind === "task") {
    return withRestoreAuto([OPEN_ACTION, toggleCompleteAction(node), CONNECT_ACTION, REMOVE_MEMBER_ACTION], node, options);
  }

  if (node.kind === "track") {
    return withRestoreAuto([OPEN_ACTION, CONNECT_ACTION, REMOVE_MEMBER_ACTION], node, options);
  }

  if (node.kind === "ghost") {
    return [REMOVE_REF_ACTION];
  }

  return withRestoreAuto([EDIT_GOAL_ACTION, toggleArchiveAction(options), DELETE_GOAL_ACTION], node, options);
}

export function actionsForEdge(edge: GoalGraphEdge): GoalAction[] {
  if (edge.kind === "tether") return [];

  return [
    {
      ...DELETE_PREREQUISITE_ACTION,
      label: edge.kind === "broken-prerequisite" ? "删除失效前置" : DELETE_PREREQUISITE_ACTION.label,
    },
  ];
}
