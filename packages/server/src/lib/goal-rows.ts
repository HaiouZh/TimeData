import type { Goal } from "@timedata/shared";

export interface GoalRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  note: string | null;
  prerequisites: string | null;
  created_at: string;
  updated_at: string;
}

export function goalToRow(data: Goal): Record<string, string | number | null> {
  return {
    id: data.id,
    title: data.title,
    kind: data.kind,
    status: data.status,
    note: data.note ?? null,
    prerequisites: JSON.stringify(data.prerequisites ?? []),
    created_at: data.createdAt,
  };
}

export function rowToGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as Goal["kind"],
    status: row.status as Goal["status"],
    ...(row.note !== null ? { note: row.note } : {}),
    prerequisites: row.prerequisites ? JSON.parse(row.prerequisites) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
