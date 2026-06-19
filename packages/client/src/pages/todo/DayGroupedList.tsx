import type { Task } from "@timedata/shared";
import { type ReactNode, useState } from "react";
import type { InboxDaySegment } from "../../lib/tasks/inboxGrouping.js";

export interface DayGroupedListProps {
  segments: InboxDaySegment[];
  renderTasks: (tasks: Task[]) => ReactNode;
  initialGroups?: number;
}

/**
 * 单卡内多日分组：组间用 hairline 分割线 + 行内小日期标签替代每段独立卡片，
 * 并默认渐进式只露最近 N 个有任务的日期组，多余的折叠到「显示更多」后。
 */
export function DayGroupedList({ segments, renderTasks, initialGroups = 3 }: DayGroupedListProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? segments : segments.slice(0, initialGroups);
  const hidden = segments.length - visible.length;

  if (segments.length === 0) {
    return null;
  }

  return (
    <div className="rounded-card bg-surface p-1.5">
      {visible.map((segment) => (
        <div key={segment.key}>
          <div className="flex items-center gap-2 px-2 pt-2 pb-1">
            <span className="shrink-0 text-xs text-ink-3">{segment.label}</span>
            <span aria-hidden="true" className="h-px flex-1 bg-border-hairline" />
          </div>
          {renderTasks(segment.tasks)}
        </div>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          aria-label={`显示更多（${hidden}）`}
          onClick={() => setExpanded(true)}
          className="mt-1 w-full rounded-ctl px-2 py-1.5 text-xs text-ink-3 hover:bg-surface-hover"
        >
          显示更多（{hidden}）
        </button>
      )}
      {expanded && segments.length > initialGroups && (
        <button
          type="button"
          aria-label="收起"
          onClick={() => setExpanded(false)}
          className="mt-1 w-full rounded-ctl px-2 py-1.5 text-xs text-ink-3 hover:bg-surface-hover"
        >
          收起
        </button>
      )}
    </div>
  );
}
