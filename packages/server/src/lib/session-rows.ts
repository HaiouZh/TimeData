import type { Session } from "@timedata/shared";

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  track_ids: string;
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
    track_ids: JSON.stringify((session as { trackIds?: unknown }).trackIds ?? []),
    created_at: session.createdAt,
  };
}

export function rowToSession(row: SessionRow): Session {
  let trackIds: string[] = [];
  const raw = (row as unknown as Record<string, unknown>).track_ids;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        trackIds = parsed as string[];
      }
    } catch {
      // 非法 JSON 回退 []
    }
  }
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? null,
    note: row.note ?? null,
    trackIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
