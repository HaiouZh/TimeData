import { GoalLayoutPinSchema, type GoalLayoutPin } from "@timedata/shared";

export {
  decodeGoalLayoutPinKey,
  encodeGoalLayoutPinKey,
  goalLayoutPinKey,
} from "@timedata/shared";

export interface GoalLayoutPinRow {
  goal_id: string;
  node_kind: string;
  node_id: string;
  x: number;
  y: number;
  updated_at: string;
}

export function goalLayoutPinToRow(data: GoalLayoutPin): Record<string, string | number | null> {
  return {
    goal_id: data.goalId,
    node_kind: data.nodeKind,
    node_id: data.nodeId,
    x: data.x,
    y: data.y,
  };
}

export function rowToGoalLayoutPin(row: GoalLayoutPinRow): GoalLayoutPin {
  return GoalLayoutPinSchema.parse({
    goalId: row.goal_id,
    nodeKind: row.node_kind,
    nodeId: row.node_id,
    x: row.x,
    y: row.y,
    updatedAt: row.updated_at,
  });
}
