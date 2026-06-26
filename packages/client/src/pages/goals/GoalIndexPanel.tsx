export interface GoalIndexItem {
  goalId: string;
  title: string;
  completed: number;
  total: number;
  weekActiveMembers: number;
}

export interface GoalIndexPanelProps {
  items: GoalIndexItem[];
  onFocus: (goalId: string) => void;
}

export function GoalIndexPanel({ items, onFocus }: GoalIndexPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-elevated text-ink">
      <div className="border-b border-border-hairline px-4 py-3">
        <h2 className="text-sm font-medium text-ink">目标</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <p className="rounded-row border border-dashed border-border px-3 py-4 text-sm text-ink-3">没有进行中的目标</p>
        ) : (
          items.map((item) => {
            const pct = item.total === 0 ? 0 : Math.round((item.completed / item.total) * 100);
            return (
              <button
                key={item.goalId}
                type="button"
                aria-label={`聚焦目标 ${item.title}`}
                data-index-goal={item.goalId}
                onClick={() => onFocus(item.goalId)}
                className="min-h-16 w-full rounded-row border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-hover"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-ink">{item.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-accent">{pct}%</span>
                </span>
                <span className="mt-1 block text-xs text-ink-3">
                  {item.completed}/{item.total} · 本周 {item.weekActiveMembers}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
