import { getDb } from "../db/connection.js";

export type PushSeqStrategy = "unknown_base" | "fast_forward_push" | "merge_non_overlapping" | "local_wins_non_fast_forward";

export interface PushSeqRecord {
  tableName: "categories" | "time_entries";
  recordId: string;
}

export interface OverlappingRecord extends PushSeqRecord {
  serverSeq: number;
}

export interface PushSeqAnalysis {
  strategy: PushSeqStrategy;
  cloudAheadCount: number;
  overlappingRecords: OverlappingRecord[];
}

export function analyzePushBaseSeq(baseSeq: number | null, pushRecords: PushSeqRecord[]): PushSeqAnalysis {
  if (baseSeq == null) {
    return { strategy: "unknown_base", cloudAheadCount: 0, overlappingRecords: [] };
  }

  const rows = getDb().prepare(`
    SELECT table_name, record_id, MAX(id) as seq
    FROM sync_seq
    WHERE id > ?
    GROUP BY table_name, record_id
    ORDER BY seq ASC
  `).all(baseSeq) as Array<{
    table_name: PushSeqRecord["tableName"];
    record_id: string;
    seq: number;
  }>;

  const serverChanges = new Map(rows.map((row) => [`${row.table_name}:${row.record_id}`, row.seq]));
  const overlappingRecords: OverlappingRecord[] = [];

  for (const record of pushRecords) {
    const serverSeq = serverChanges.get(`${record.tableName}:${record.recordId}`);
    if (serverSeq != null) {
      overlappingRecords.push({ ...record, serverSeq });
    }
  }

  if (overlappingRecords.length > 0) {
    return { strategy: "local_wins_non_fast_forward", cloudAheadCount: rows.length, overlappingRecords };
  }

  if (rows.length > 0) {
    return { strategy: "merge_non_overlapping", cloudAheadCount: rows.length, overlappingRecords };
  }

  return { strategy: "fast_forward_push", cloudAheadCount: 0, overlappingRecords };
}
