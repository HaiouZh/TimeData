import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../db/index.ts";

export function useUnsyncedQuickNoteIds(): Set<string> {
  const ids = useLiveQuery(async () => {
    const logs = await db.syncLog.where("[tableName+synced]").equals(["quick_notes", 0]).toArray();
    return logs.map((log) => log.recordId);
  }, []);

  return useMemo(() => new Set(ids ?? []), [ids]);
}
