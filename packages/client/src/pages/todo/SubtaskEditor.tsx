import { useRef } from "react";
import { v4 as uuid } from "uuid";
import type { TaskSubtask } from "@timedata/shared";
import { insertSubtaskAfter, removeSubtaskAt, setSubtaskTitle, toggleSubtask } from "../../lib/tasks/subtasks.js";

export function SubtaskEditor({
  value, onChange, genId = uuid,
}: { value: TaskSubtask[]; onChange: (next: TaskSubtask[]) => void; genId?: () => string }) {
  const refs = useRef(new Map<string, HTMLInputElement>());
  const focusEnd = (id: string) => requestAnimationFrame(() => {
    const el = refs.current.get(id); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });

  return (
    <ul className="space-y-1">
      {value.map((s, index) => (
        <li key={s.id} className="flex items-center gap-2">
          <input type="checkbox" aria-label={`完成子任务 ${s.title}`} checked={s.done}
            onChange={() => onChange(toggleSubtask(value, s.id))}
            className="h-4 w-4 accent-sky-500" />
          <input
            ref={(el) => { if (el) refs.current.set(s.id, el); else refs.current.delete(s.id); }}
            value={s.title}
            aria-label="子任务标题"
            onChange={(e) => onChange(setSubtaskTitle(value, s.id, e.currentTarget.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const { items, newId } = insertSubtaskAfter(value, index, genId);
                onChange(items); focusEnd(newId);
              } else if (e.key === "Backspace" && e.currentTarget.value.length === 0) {
                e.preventDefault();
                const prev = value[index - 1] ?? value[index + 1];
                onChange(removeSubtaskAt(value, index));
                if (prev) focusEnd(prev.id);
              }
            }}
            className={`min-h-8 flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 text-sm ${s.done ? "text-slate-500 line-through" : "text-slate-100"}`}
          />
        </li>
      ))}
      <li>
        <button type="button"
          onClick={() => { const { items, newId } = insertSubtaskAfter(value, value.length - 1, genId); onChange(items); focusEnd(newId); }}
          className="min-h-8 text-xs text-slate-400">+ 添加子任务</button>
      </li>
    </ul>
  );
}
