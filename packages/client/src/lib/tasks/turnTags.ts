import type { Task } from "@timedata/shared";

export interface TurnBuckets {
  me: Task[];
  running: Task[];
  parked: Task[];
}

type Turn = NonNullable<Task["turn"]>;

const TURN_ORDER: Turn[] = ["me", "running", "parked"];

function byTurnAtAsc(now: Date): (a: Task, b: Task) => number {
  // turnAt 为 null 视为最远未来（排末尾），避免 null 与 ISO 字符串比较出错。
  const far = now.toISOString();
  return (a, b) => {
    const ta = a.turnAt ?? far;
    const tb = b.turnAt ?? far;
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  };
}

export function turnBuckets(tasks: Task[], now: Date): TurnBuckets {
  const buckets: TurnBuckets = { me: [], running: [], parked: [] };
  for (const t of tasks) {
    if (t.done) continue;
    if (t.turn && TURN_ORDER.includes(t.turn)) {
      buckets[t.turn].push(t);
    }
  }
  const cmp = byTurnAtAsc(now);
  buckets.me.sort(cmp);
  buckets.running.sort(cmp);
  buckets.parked.sort(cmp);
  return buckets;
}

export function allTags(tasks: Task[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    for (const tag of t.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count - a.count) || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

export function filterByTags(tasks: Task[], selected: string[]): Task[] {
  if (selected.length === 0) return tasks;
  const set = new Set(selected);
  return tasks.filter((t) => (t.tags ?? []).some((tag) => set.has(tag)));
}
