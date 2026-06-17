import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMemo, useRef } from "react";
import { v4 as uuid } from "uuid";
import type { TaskSubtask } from "@timedata/shared";
import {
  insertSubtaskAfter,
  removeSubtaskAt,
  reorderSubtasks,
  setSubtaskTitle,
  toggleSubtask,
} from "../../lib/tasks/subtasks.js";
import { SortableSubtaskRow } from "./SortableSubtaskRow.js";

export function SubtaskEditor({
  value,
  onChange,
  genId = uuid,
}: { value: TaskSubtask[]; onChange: (next: TaskSubtask[]) => void; genId?: () => string }) {
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const registerRef = (id: string, el: HTMLTextAreaElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };
  const focusEnd = (id: string) => requestAnimationFrame(() => {
    const el = refs.current.get(id);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  const ids = useMemo(() => value.map((s) => s.id), [value]);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over) return;
    onChange(reorderSubtasks(value, String(active.id), String(over.id)));
  }

  function addAt(index: number): void {
    const { items, newId } = insertSubtaskAfter(value, index, genId);
    onChange(items);
    focusEnd(newId);
  }

  function removeAt(index: number): void {
    const prev = value[index - 1] ?? value[index + 1];
    onChange(removeSubtaskAt(value, index));
    if (prev) focusEnd(prev.id);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1">
          {value.map((s, index) => (
            <SortableSubtaskRow
              key={s.id}
              subtask={s}
              registerRef={registerRef}
              onToggle={() => onChange(toggleSubtask(value, s.id))}
              onTitleChange={(title) => onChange(setSubtaskTitle(value, s.id, title))}
              onEnter={() => addAt(index)}
              onBackspaceEmpty={() => removeAt(index)}
            />
          ))}
          <li>
            <button type="button" onClick={() => addAt(value.length - 1)} className="min-h-8 text-xs text-slate-400">
              + 添加子任务
            </button>
          </li>
        </ul>
      </SortableContext>
    </DndContext>
  );
}
