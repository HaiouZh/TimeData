export interface TaskSortSlot {
  id: string;
  sortOrder: number;
}

export interface TaskSortChange {
  id: string;
  sortOrder: number;
}

export function reorderedTaskSortOrders(poolTasks: TaskSortSlot[], orderedIds: string[]): TaskSortChange[] {
  if (orderedIds.length !== poolTasks.length) return [];
  const byId = new Map(poolTasks.map((task) => [task.id, task]));
  if (orderedIds.some((id) => !byId.has(id))) return [];
  if (new Set(orderedIds).size !== orderedIds.length) return [];

  const slots = poolTasks.map((task) => task.sortOrder).sort((a, b) => a - b);
  const changes: TaskSortChange[] = [];
  orderedIds.forEach((id, index) => {
    const current = byId.get(id);
    if (current && current.sortOrder !== slots[index]) {
      changes.push({ id, sortOrder: slots[index] });
    }
  });
  return changes;
}
