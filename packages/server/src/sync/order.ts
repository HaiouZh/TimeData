import type { SyncChange } from "@timedata/shared";

export function orderPushChanges(changes: SyncChange[]): SyncChange[] {
  const categoryUpserts = changes.filter((change) => change.tableName === "categories" && change.action !== "delete");
  const entryChanges = changes.filter((change) => change.tableName === "time_entries");
  const categoryDeletes = changes.filter((change) => change.tableName === "categories" && change.action === "delete");

  return [...categoryUpserts, ...entryChanges, ...categoryDeletes];
}
