import type { Task } from "@timedata/shared";

export function allTags(tasks: Task[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    for (const tag of t.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

export function filterByTags(tasks: Task[], selected: string[]): Task[] {
  if (selected.length === 0) return tasks;
  const set = new Set(selected);
  return tasks.filter((t) => (t.tags ?? []).some((tag) => set.has(tag)));
}
