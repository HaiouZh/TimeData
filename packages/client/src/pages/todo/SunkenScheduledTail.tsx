import type { Task } from "@timedata/shared";
import { useState } from "react";
import { TaskList } from "./TaskList.js";

interface SunkenScheduledTailProps {
  sunkenTasks: Task[];
  goalLinkedIds?: ReadonlySet<string>;
  onToggle: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToToday: (t: Task) => void;
  onToInbox: (t: Task) => void;
}

/**
 * 已排期区 7 天水位线的水下入口：下一发生日在「今天+7 天」之外的任务/规则。
 * 默认收起只显示「更远还有 N 条」；展开渲染完整列表（与水上同款行，不参与 DnD）。
 */
export function SunkenScheduledTail({ sunkenTasks, goalLinkedIds, ...rowHandlers }: SunkenScheduledTailProps) {
  const [expanded, setExpanded] = useState(false);

  if (sunkenTasks.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full rounded-ctl px-2 py-1.5 td-text-caption text-ink-3 hover:bg-surface-hover"
      >
        {expanded ? `收起更远 ${sunkenTasks.length} 条` : `更远还有 ${sunkenTasks.length} 条`}
      </button>
      {expanded && <TaskList pool="upcoming" tasks={sunkenTasks} goalLinkedIds={goalLinkedIds} {...rowHandlers} />}
    </div>
  );
}
