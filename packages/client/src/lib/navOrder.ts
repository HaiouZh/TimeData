import { arrayMove } from "@dnd-kit/sortable";

export function reorderById<T>(
  items: readonly T[],
  activeId: string,
  overId: string,
  idOf: (item: T) => string,
): T[] {
  const oldIndex = items.findIndex((item) => idOf(item) === activeId);
  const newIndex = items.findIndex((item) => idOf(item) === overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return [...items];
  return arrayMove([...items], oldIndex, newIndex);
}