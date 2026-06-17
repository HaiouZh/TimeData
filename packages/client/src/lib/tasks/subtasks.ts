import { arrayMove } from "@dnd-kit/sortable";
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

/** 子任务是否发生结构性变更（增删/勾选/重排），纯改文字返回 false。 */
export function subtasksDifferStructurally(prev: TaskSubtask[], next: TaskSubtask[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].id !== next[i].id) return true;
    if (prev[i].done !== next[i].done) return true;
  }
  return false;
}

export function reorderSubtasks(items: TaskSubtask[], activeId: string, overId: string): TaskSubtask[] {
  if (activeId === overId) return items;
  const oldIndex = items.findIndex((s) => s.id === activeId);
  const newIndex = items.findIndex((s) => s.id === overId);
  if (oldIndex === -1 || newIndex === -1) return items;
  return arrayMove(items, oldIndex, newIndex);
}

/** 子任务完成比例：total <= 0 返回 null（不渲染进度条），否则 done / total 夹取到 0..1。 */
export function subtaskProgress(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, done / total));
}
