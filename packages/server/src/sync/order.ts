import type { SyncChange } from "@timedata/shared";

function orderCategoryUpserts(changes: SyncChange[]): SyncChange[] {
  const byId = new Map(changes.map((change) => [change.recordId, change]));
  const ordered: SyncChange[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(change: SyncChange): void {
    if (visited.has(change.recordId) || visiting.has(change.recordId)) return;
    visiting.add(change.recordId);

    const parentId =
      change.data && typeof change.data === "object" && "parentId" in change.data
        ? (change.data as { parentId?: unknown }).parentId
        : null;
    if (typeof parentId === "string") {
      const parent = byId.get(parentId);
      if (parent) visit(parent);
    }

    visiting.delete(change.recordId);
    visited.add(change.recordId);
    ordered.push(change);
  }

  for (const change of changes) visit(change);
  return ordered;
}

export function orderPushChanges(changes: SyncChange[]): SyncChange[] {
  const categoryUpserts = orderCategoryUpserts(
    changes.filter((change) => change.tableName === "categories" && change.action !== "delete"),
  );
  const entryChanges = changes.filter((change) => change.tableName === "time_entries");
  const categoryDeletes = changes.filter((change) => change.tableName === "categories" && change.action === "delete");

  return [...categoryUpserts, ...entryChanges, ...categoryDeletes];
}
