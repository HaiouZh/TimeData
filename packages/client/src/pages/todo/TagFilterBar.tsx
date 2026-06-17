import type { Task } from "@timedata/shared";
import { allTags } from "../../lib/tasks/turnTags.js";

export interface TagFilterBarProps {
  tasks: Task[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}

export function TagFilterBar({ tasks, selected, onToggle, onClear }: TagFilterBarProps) {
  const tags = allTags(tasks);
  if (tags.length === 0) return null;
  const selectedSet = new Set(selected);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="tag-filter-bar">
      {tags.map(({ tag }) => {
        const active = selectedSet.has(tag);
        return (
          <button
            key={tag}
            type="button"
            aria-label={`筛选 ${tag}`}
            aria-pressed={active}
            onClick={() => onToggle(tag)}
            className={`rounded-pill px-2 py-0.5 text-xs transition-colors ${
              active ? "bg-accent text-page" : "bg-surface-hover text-ink-2 hover:text-ink"
            }`}
          >
            #{tag}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          aria-label="清除筛选"
          onClick={onClear}
          className="rounded-pill px-2 py-0.5 text-xs text-ink-3 hover:text-ink"
        >
          清除
        </button>
      )}
    </div>
  );
}
