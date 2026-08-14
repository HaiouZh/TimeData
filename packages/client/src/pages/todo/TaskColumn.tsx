import type { ReactNode } from "react";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { TaskList, type TaskListProps } from "./TaskList.js";

export interface TaskColumnProps extends TaskListProps {
  title: string;
  emptyText: string;
  hero?: boolean;
  /**
   * 卡片内、`TaskList` **之后**的附加内容（轨道组）。
   * 必须在 `TaskList` 的 `SortableContext` 之外——夹进去会扰乱拖拽排序的位置计算。
   */
  extra?: ReactNode;
}

export function TaskColumn(props: TaskColumnProps) {
  const { title, pool, tasks, emptyText, hero, extra, ...listProps } = props;
  const empty = tasks.length === 0 && !extra;

  return (
    <section data-section={pool}>
      <div className="mb-2 flex items-baseline justify-between px-2">
        <h2 className={`font-medium text-ink ${hero ? "td-text-body" : "td-text-label"}`}>{title}</h2>
        <span className="td-text-caption text-ink-3">{tasks.length}</span>
      </div>
      {empty ? (
        <EmptyState variant="card" title={emptyText} />
      ) : (
        <div className="rounded-card p-1.5">
          {tasks.length > 0 && <TaskList pool={pool} tasks={tasks} {...listProps} />}
          {extra}
        </div>
      )}
    </section>
  );
}
