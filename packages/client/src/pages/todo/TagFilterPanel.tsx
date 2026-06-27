import { tagColor } from "../../lib/tasks/turnTags.js";

export interface TagFilterPanelProps {
  tags: { tag: string; count: number }[];
  includeTags: string[];
  excludeTags: string[];
  tagMode: "and" | "or";
  notMode: boolean;
  onToggleTag: (tag: string) => void;
  onToggleMode: () => void;
  onToggleNotMode: () => void;
  onClear: () => void;
  className?: string;
}

type ChipState = "unselected" | "include" | "exclude";

const TOGGLE_BTN =
  "min-h-9 rounded-pill border border-border px-3 text-xs transition-colors disabled:opacity-40";

export function TagFilterPanel({
  tags,
  includeTags,
  excludeTags,
  tagMode,
  notMode,
  onToggleTag,
  onToggleMode,
  onToggleNotMode,
  onClear,
  className,
}: TagFilterPanelProps) {
  if (tags.length === 0) return null;

  const includeSet = new Set(includeTags);
  const excludeSet = new Set(excludeTags);
  const hasSelection = includeTags.length > 0 || excludeTags.length > 0;

  return (
    <div
      className={`flex max-h-[40vh] flex-1 flex-wrap items-center gap-1.5 overflow-y-auto ${className ?? ""}`}
      data-testid="tag-filter-panel"
    >
      <button
        type="button"
        data-testid="tag-mode-toggle"
        aria-pressed={tagMode === "or"}
        onClick={onToggleMode}
        className={`${TOGGLE_BTN} ${tagMode === "or" ? "bg-accent text-page" : "text-ink-2 hover:text-ink"}`}
      >
        OR
      </button>
      <button
        type="button"
        data-testid="tag-not-toggle"
        aria-pressed={notMode}
        onClick={onToggleNotMode}
        className={`${TOGGLE_BTN} ${notMode ? "bg-accent text-page" : "text-ink-2 hover:text-ink"}`}
      >
        NOT
      </button>
      <button
        type="button"
        aria-label="清除筛选"
        disabled={!hasSelection}
        onClick={onClear}
        className={`${TOGGLE_BTN} text-ink-3 hover:text-ink`}
      >
        清除
      </button>

      {tags.map(({ tag, count }) => {
        const color = tagColor(tag);
        const state: ChipState = includeSet.has(tag) ? "include" : excludeSet.has(tag) ? "exclude" : "unselected";
        const style =
          state === "include"
            ? { backgroundColor: color, color: "var(--color-page)", borderColor: color }
            : state === "unselected"
              ? { borderColor: color }
              : undefined;
        const cls =
          state === "exclude"
            ? "border-danger text-danger line-through"
            : state === "include"
              ? ""
              : "text-ink-2 hover:text-ink";
        return (
          <button
            key={tag}
            type="button"
            data-testid="tag-filter-chip"
            data-state={state}
            aria-label={`筛选 ${tag}`}
            aria-pressed={state === "include"}
            onClick={() => onToggleTag(tag)}
            className={`min-h-9 rounded-pill border px-2.5 text-xs transition-colors ${cls}`}
            style={style}
          >
            #{tag}
            <span className="ml-1 opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
