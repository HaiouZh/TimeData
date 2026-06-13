import type { SyncChange } from "@timedata/shared";
import { SYNC_DOMAINS, type SyncDomainConfig, getSyncDomain } from "@timedata/shared";

// categories upsert 组内按父子拓扑排序，保证父分类先于子分类落库。
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

function priorityOf(change: SyncChange, registry: readonly SyncDomainConfig[]): number {
  const domain = getSyncDomain(change.tableName, registry);
  return change.action === "delete" ? domain.deletePriority : domain.upsertPriority;
}

// 按登记簿优先级稳定排序：categories upsert → time_entries → settings → quick_notes → categories delete。
// registry 参数仅测试注入用，生产代码用默认登记簿。
export function orderPushChanges(changes: SyncChange[], registry: readonly SyncDomainConfig[] = SYNC_DOMAINS): SyncChange[] {
  const groups = new Map<number, SyncChange[]>();
  for (const change of changes) {
    const priority = priorityOf(change, registry);
    const group = groups.get(priority) ?? [];
    group.push(change);
    groups.set(priority, group);
  }

  const categoryUpsertPriority = getSyncDomain("categories", registry).upsertPriority;
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([priority, group]) => (priority === categoryUpsertPriority ? orderCategoryUpserts(group) : group));
}
