import { ArrowUp } from "@phosphor-icons/react";
import type { Task } from "@timedata/shared";
import { type ReactNode, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { groupInboxByDay } from "../../lib/tasks/inboxGrouping.js";
import { TaskList } from "./TaskList.js";

interface SunkenInboxTailProps {
  sunkenTasks: Task[];
  stickyBottomOffsetPx: number;
  extraAction?: (task: Task) => ReactNode;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onToToday: (task: Task) => void;
  onToInbox: (task: Task) => void;
  onAfterChildWrite?: () => void;
}

/**
 * Inbox 展开链条尾部的水下完整列表入口。
 * 默认收起，只显示「水下 X 条」；展开后渲染完整 sunkenTasks，不注册 DnD。
 */
export function SunkenInboxTail({
  sunkenTasks,
  stickyBottomOffsetPx: _stickyBottomOffsetPx,
  extraAction,
  ...rowHandlers
}: SunkenInboxTailProps) {
  const [expanded, setExpanded] = useState(false);

  if (sunkenTasks.length === 0) return null;

  const segments = groupInboxByDay(sunkenTasks);

  return (
    <div className="mt-1 rounded-card bg-surface p-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full rounded-ctl px-2 py-1.5 text-xs text-ink-3 hover:bg-surface-hover"
      >
        {expanded ? `收起水下 ${sunkenTasks.length} 条` : `水下 ${sunkenTasks.length} 条`}
      </button>
      {expanded && (
        <div className="mt-1">
          {segments.map((segment) => (
            <div key={segment.key}>
              <div className="flex items-center gap-2 px-2 pt-2 pb-1">
                <span className="shrink-0 text-xs text-ink-3">{segment.label}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-border-hairline" />
              </div>
              <TaskList
                pool="inbox"
                tasks={segment.tasks}
                extraAction={extraAction}
                childrenModeOverride="static"
                {...rowHandlers}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 复用 GravityReviewSection 同款「顶一下」extraAction 工厂。 */
export function makeSunkenExtraAction(onBump: (task: Task) => void | Promise<void>) {
  return (task: Task) => (
    <button
      type="button"
      aria-label={`顶一下 ${task.title}`}
      onClick={(event) => {
        event.stopPropagation();
        void onBump(task);
      }}
      className="flex h-6 w-6 items-center justify-center rounded-ctl text-ink-3 hover:bg-surface-elevated hover:text-accent"
    >
      <Icon icon={ArrowUp} size={16} />
    </button>
  );
}