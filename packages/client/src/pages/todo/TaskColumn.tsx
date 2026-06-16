import {
  LeadingActions, SwipeableList, SwipeableListItem, SwipeAction, TrailingActions, Type as ListType,
} from "@meauxt/react-swipeable-list";
import "@meauxt/react-swipeable-list/dist/styles.css";
import type { Task } from "@timedata/shared";
import { TaskRow, type TaskPool } from "./TaskRow.js";

export interface TaskColumnProps {
  title: string;
  pool: Extract<TaskPool, "today" | "inbox" | "upcoming">;
  tasks: Task[];
  emptyText: string;
  hero?: boolean;
  isOverdue?: (t: Task) => boolean;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToToday: (t: Task) => void;
  onToInbox: (t: Task) => void;
}

export function TaskColumn(props: TaskColumnProps) {
  const { title, pool, tasks, emptyText, hero, isOverdue } = props;

  return (
    <section data-section={pool}>
      <div className="mb-2 flex items-baseline justify-between px-2">
        <h2 className={`font-medium text-ink ${hero ? "text-base" : "text-sm"}`}>{title}</h2>
        <span className="text-xs text-ink-3">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">{emptyText}</p>
      ) : (
        <div className="rounded-card bg-surface p-1.5">
          <SwipeableList type={ListType.IOS} fullSwipe={false}>
            {tasks.map((task) => {
              const canSwap = task.recurrence === null;
              const leading = canSwap && (pool === "inbox" || pool === "upcoming") ? (
                <LeadingActions>
                  <SwipeAction onClick={() => props.onToToday(task)}>
                    <div className="flex h-full items-center bg-accent-strong px-4 text-sm font-medium text-page">
                      排进今天
                    </div>
                  </SwipeAction>
                </LeadingActions>
              ) : undefined;
              const trailing = (
                <TrailingActions>
                  {canSwap && pool === "today" && (
                    <SwipeAction onClick={() => props.onToInbox(task)}>
                      <div className="flex h-full items-center bg-surface-elevated px-4 text-sm font-medium text-ink">
                        回收件箱
                      </div>
                    </SwipeAction>
                  )}
                  <SwipeAction destructive onClick={() => props.onDelete(task)}>
                    <div className="flex h-full items-center bg-danger px-4 text-sm font-medium text-page">删除</div>
                  </SwipeAction>
                </TrailingActions>
              );
              return (
                <SwipeableListItem key={task.id} leadingActions={leading} trailingActions={trailing}>
                  <TaskRow
                    task={task}
                    pool={pool}
                    overdue={pool === "today" && (isOverdue?.(task) ?? false)}
                    onToggle={props.onToggle}
                    onEdit={props.onEdit}
                    onDelete={props.onDelete}
                    onToToday={props.onToToday}
                    onToInbox={props.onToInbox}
                  />
                </SwipeableListItem>
              );
            })}
          </SwipeableList>
        </div>
      )}
    </section>
  );
}
