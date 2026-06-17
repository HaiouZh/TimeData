import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import type { TaskSubtask } from "@timedata/shared";
import { SubtaskRow } from "./SubtaskRow.js";

export function SortableSubtaskRow({
  subtask,
  registerRef,
  onToggle,
  onTitleChange,
  onEnter,
  onBackspaceEmpty,
}: {
  subtask: TaskSubtask;
  registerRef: (id: string, el: HTMLTextAreaElement | null) => void;
  onToggle: () => void;
  onTitleChange: (value: string) => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: subtask.id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group flex items-start gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-hover"
    >
      <SubtaskRow
        subtask={subtask}
        registerRef={registerRef}
        onToggle={onToggle}
        onTitleChange={onTitleChange}
        onEnter={onEnter}
        onBackspaceEmpty={onBackspaceEmpty}
      />
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`拖动子任务 ${subtask.title}`}
        className="shrink-0 cursor-grab touch-none select-none rounded px-2 py-1 text-ink-3 opacity-80 hover:bg-surface-hover hover:text-ink-2 group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        ≡
      </button>
    </li>
  );
}
