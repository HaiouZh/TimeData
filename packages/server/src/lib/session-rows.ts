import type { Session } from "@timedata/shared";

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 不含 updated_at：服务器记账时分配。 */
export function sessionToRow(data: unknown): Record<string, string | number | null> {
  const session = data as Session;
  return {
    id: session.id,
    started_at: session.startedAt,
    ended_at: session.endedAt ?? null,
    note: session.note ?? null,
    created_at: session.createdAt,
  };
}

export function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
