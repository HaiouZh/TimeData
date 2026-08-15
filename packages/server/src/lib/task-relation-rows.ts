import { TaskRelationSchema, type TaskRelation } from "@timedata/shared";

export { decodeTaskRelationKey, encodeTaskRelationKey, taskRelationKey } from "@timedata/shared";

export interface TaskRelationRow {
  blocker_kind: string;
  blocker_id: string;
  blocked_kind: string;
  blocked_id: string;
  type: string;
  created_at: string;
  updated_at: string;
}

export function taskRelationToRow(data: TaskRelation): Record<string, string | number | null> {
  return {
    blocker_kind: data.blockerKind,
    blocker_id: data.blockerId,
    blocked_kind: data.blockedKind,
    blocked_id: data.blockedId,
    type: data.type,
    created_at: data.createdAt,
  };
}

export function rowToTaskRelation(row: TaskRelationRow): TaskRelation {
  return TaskRelationSchema.parse({
    blockerKind: row.blocker_kind,
    blockerId: row.blocker_id,
    blockedKind: row.blocked_kind,
    blockedId: row.blocked_id,
    type: row.type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
