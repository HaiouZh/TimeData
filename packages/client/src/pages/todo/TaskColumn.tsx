import { TaskList, type TaskListProps } from "./TaskList.js";

export interface TaskColumnProps extends TaskListProps {
  title: string;
  emptyText: string;
  hero?: boolean;
}

export function TaskColumn(props: TaskColumnProps) {
  const { title, pool, tasks, emptyText, hero, ...listProps } = props;

  return (
    <section data-section={pool}>
      <div className="mb-2 flex items-baseline justify-between px-2">
        <h2 className={`font-medium text-ink ${hero ? "td-text-body" : "td-text-label"}`}>{title}</h2>
        <span className="td-text-caption text-ink-3">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-card bg-surface px-3 py-6 text-center td-text-body text-ink-3">{emptyText}</p>
      ) : (
        <div className="rounded-card p-1.5">
          <TaskList pool={pool} tasks={tasks} {...listProps} />
        </div>
      )}
    </section>
  );
}