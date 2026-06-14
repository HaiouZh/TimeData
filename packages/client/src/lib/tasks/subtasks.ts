import type { TaskSubtask } from "@timedata/shared";

export function insertSubtaskAfter(
  items: TaskSubtask[], index: number, genId: () => string,
): { items: TaskSubtask[]; newId: string } {
  const newId = genId();
  const next = items.slice();
  next.splice(index + 1, 0, { id: newId, title: "", done: false });
  return { items: next, newId };
}

export function removeSubtaskAt(items: TaskSubtask[], index: number): TaskSubtask[] {
  const next = items.slice();
  next.splice(index, 1);
  return next;
}

export function toggleSubtask(items: TaskSubtask[], id: string): TaskSubtask[] {
  return items.map((s) => (s.id === id ? { ...s, done: !s.done } : s));
}

export function setSubtaskTitle(items: TaskSubtask[], id: string, title: string): TaskSubtask[] {
  return items.map((s) => (s.id === id ? { ...s, title } : s));
}

export function applyParentToggle(items: TaskSubtask[], done: boolean): TaskSubtask[] {
  return items.map((s) => ({ ...s, done }));
}

export function deriveParentDone(items: TaskSubtask[]): boolean {
  return items.length > 0 && items.every((s) => s.done);
}

export function trimSubtasks(items: TaskSubtask[]): TaskSubtask[] {
  return items
    .map((s) => ({ ...s, title: s.title.trim() }))
    .filter((s) => s.title.length > 0);
}
