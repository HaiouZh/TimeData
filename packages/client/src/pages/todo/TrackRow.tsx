import { Link } from "react-router";
import type { TodoTrackRow } from "../../lib/tasks/todoTrackRows.js";

/**
 * todo 页的轨道行。与任务行同区并排，靠**形状**区分类型（三道刻度 = 轨道，方框 = 任务）。
 *
 * 不注册 sortable / droppable，且**永远渲染在 `SortableContext` 之外**：
 * `verticalListSortingStrategy` 按 DOM 顺序算位置，夹进任务行之间会扰乱计算。
 */
export function TrackRow({ row }: { row: TodoTrackRow }) {
  return (
    <Link
      to={`/tracks/${encodeURIComponent(row.track.id)}`}
      data-testid="todo-track-row"
      aria-label={`查看轨道 ${row.track.title}`}
      className="flex items-start gap-2.5 rounded-row px-2 py-2 transition-colors duration-150 hover:bg-surface-hover"
    >
      <span aria-hidden className="mt-1 flex shrink-0 flex-col items-center gap-0.5">
        <span className="block h-px w-3 bg-ink-3" />
        <span className="block h-px w-2 bg-ink-3" />
        <span className="block h-px w-2.5 bg-ink-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block td-text-body text-ink">{row.track.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 td-text-caption text-ink-3">
          <span className="td-num">{row.stepCount} 步</span>
          {row.hasOpenStep && <span className="text-accent-ink">进行中</span>}
        </span>
      </span>
    </Link>
  );
}
