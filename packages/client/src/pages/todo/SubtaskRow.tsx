import type { KeyboardEvent } from "react";
import type { TaskSubtask } from "@timedata/shared";
import { Checkbox } from "../../components/ui/Checkbox.js";

export interface SubtaskRowProps {
  subtask: TaskSubtask;
  registerRef: (id: string, el: HTMLTextAreaElement | null) => void;
  onToggle: () => void;
  onTitleChange: (value: string) => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
}

/** 子任务展示叶子：复选框 + 自适应 textarea + 键盘行为。 */
export function SubtaskRow({
  subtask,
  registerRef,
  onToggle,
  onTitleChange,
  onEnter,
  onBackspaceEmpty,
}: SubtaskRowProps) {
  function autoGrow(el: HTMLTextAreaElement | null): void {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onEnter();
      return;
    }

    if (event.key === "Backspace" && event.currentTarget.value.length === 0) {
      event.preventDefault();
      onBackspaceEmpty();
    }
  }

  return (
    <>
      <Checkbox
        ariaLabel={`完成子任务 ${subtask.title}`}
        checked={subtask.done}
        onChange={() => onToggle()}
        className="shrink-0"
      />
      <textarea
        ref={(el) => {
          registerRef(subtask.id, el);
          autoGrow(el);
        }}
        value={subtask.title}
        rows={1}
        aria-label="子任务标题"
        onChange={(event) => {
          onTitleChange(event.currentTarget.value);
          autoGrow(event.currentTarget);
        }}
        onKeyDown={handleKeyDown}
        className={`min-h-8 min-w-0 flex-1 resize-none break-words bg-transparent px-1 py-1 text-sm outline-none focus:bg-surface-hover ${
          subtask.done ? "text-ink-3 line-through" : "text-ink"
        }`}
      />
    </>
  );
}
