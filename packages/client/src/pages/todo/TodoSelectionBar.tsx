import { useState } from "react";

export interface TodoSelectionBarProps {
  selectedCount: number;
  /** 可选的已有项目组；空数组时不渲染「放进…」。 */
  projects: readonly { goalId: string; goalTitle: string }[];
  /** 与 TodoComposer 同源的底部避让（导航条高度）。 */
  bottomOffsetPx: number;
  onCreate: (title: string) => void;
  onAssign: (goalId: string) => void;
  onCancel: () => void;
}

/**
 * 多选态下顶替 TodoComposer 的底部操作栏。
 *
 * 命名就地输入而不是弹对话框（design §动作一 拍板）：少一次跳转，且弹窗会盖住刚选好的那几行——
 * 用户正需要看着它们确认选对了没有。
 */
export function TodoSelectionBar({
  selectedCount,
  projects,
  bottomOffsetPx,
  onCreate,
  onAssign,
  onCancel,
}: TodoSelectionBarProps) {
  const [title, setTitle] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const trimmed = title.trim();
  const hasSelection = selectedCount > 0;
  const canCreate = hasSelection && trimmed !== "";

  function submitCreate(): void {
    if (!canCreate) return;
    onCreate(trimmed);
  }

  return (
    <div
      data-testid="todo-selection-bar"
      className="fixed inset-x-0 z-[var(--z-sticky)] px-4"
      style={{ bottom: bottomOffsetPx }}
    >
      <div className="mx-auto w-full max-w-2xl">
        {pickerOpen && projects.length > 0 && (
          <ul className="mb-2 max-h-60 overflow-y-auto rounded-card border border-border-strong bg-surface py-1 shadow-elev1">
            {projects.map((project) => (
              <li key={project.goalId}>
                <button
                  type="button"
                  aria-label={`放进 ${project.goalTitle}`}
                  onClick={() => onAssign(project.goalId)}
                  className="w-full px-3 py-2 text-left td-text-body text-ink hover:bg-surface-hover"
                >
                  {project.goalTitle}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2 rounded-card border border-border-strong bg-surface px-3 py-2 shadow-elev1">
          <span className="shrink-0 td-text-caption text-ink-2">已选 {selectedCount} 条</span>
          <input
            aria-label="项目名"
            value={title}
            placeholder="新项目名"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitCreate();
            }}
            className="min-w-0 flex-1 rounded-ctl bg-surface-elevated px-2 py-1 td-text-body text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            aria-label="圈成项目"
            disabled={!canCreate}
            onClick={submitCreate}
            className="shrink-0 rounded-ctl px-2 py-1 td-text-label font-medium text-accent disabled:opacity-40"
          >
            圈成项目
          </button>
          {projects.length > 0 && (
            <button
              type="button"
              aria-label="放进已有项目"
              disabled={!hasSelection}
              onClick={() => setPickerOpen((open) => !open)}
              className="shrink-0 rounded-ctl px-2 py-1 td-text-label text-ink-2 disabled:opacity-40"
            >
              放进…
            </button>
          )}
          <button
            type="button"
            aria-label="取消多选"
            onClick={onCancel}
            className="shrink-0 rounded-ctl px-2 py-1 td-text-label text-ink-3"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
