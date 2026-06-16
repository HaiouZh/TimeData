import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, KeyboardEvent } from "react";
import type { TaskSubtask } from "@timedata/shared";

export function SortableSubtaskRow({
  subtask,
  registerRef,
  onToggle,
  onTitleChange,
  onEnter,
  onBackspaceEmpty,
}: {
  subtask: TaskSubtask;
  registerRef: (id: string, el: HTMLInputElement | null) => void;
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

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEnter();
    } else if (e.key === "Backspace" && e.currentTarget.value.length === 0) {
      e.preventDefault();
      onBackspaceEmpty();
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-slate-800/40"
    >
      <input
        type="checkbox"
        aria-label={`完成子任务 ${subtask.title}`}
        checked={subtask.done}
        onChange={onToggle}
        className="h-4 w-4 rounded-full accent-sky-500"
      />
      <input
        ref={(el) => registerRef(subtask.id, el)}
        value={subtask.title}
        aria-label="子任务标题"
        onChange={(e) => onTitleChange(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        className={`min-h-8 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none focus:bg-slate-800/50 ${subtask.done ? "text-slate-500 line-through" : "text-slate-100"}`}
      />
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`拖动子任务 ${subtask.title}`}
        className="shrink-0 cursor-grab touch-none select-none rounded px-2 py-1 text-slate-600 opacity-80 hover:bg-slate-800 hover:text-slate-200 group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        ≡
      </button>
    </li>
  );
}
