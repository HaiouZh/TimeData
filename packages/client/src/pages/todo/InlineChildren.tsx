import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task } from "@timedata/shared";
import {
  createChildTask,
  deleteTaskCascade,
  toggleTaskDone,
  updateTask,
} from "../../lib/tasks.js";
import { ReadonlyChildRow, SortableChildRow, StaticChildRow } from "./SortableChildRow.js";
import { useTaskChildren } from "./useTaskChildren.js";

export type InlineChildrenMode = "draggable" | "static" | "readonly";

export interface InlineChildrenProps {
  parentId: string;
  mode: InlineChildrenMode;
  /** 写库后回调，宿主可在此触发同步。 */
  onAfterWrite?: () => void;
}

/**
 * 父任务下的子任务列表，三种模式：
 * - draggable：完整交互（勾选/编辑/拖拽/删除/新增）。draggable 模式只渲染 `SortableContext`，
 *   期待外层 `TodoPage` 提供顶层 `DndContext`；不再嵌套自己的 `DndContext`。
 * - static：可勾选/编辑/删除/新增，但不参与拖拽（已排期）。
 * - readonly：纯展示快照，无任何写入入口（已完成 occurrence）。
 *
 * 不渲染 recurrence/tags/turn/scheduledAt 入口——子任务隐藏高级控件。
 */
export function InlineChildren({ parentId, mode, onAfterWrite }: InlineChildrenProps) {
  const children = useTaskChildren(parentId);

  function notify(): void {
    onAfterWrite?.();
  }

  async function handleToggle(child: Task): Promise<void> {
    await toggleTaskDone(child.id);
    notify();
  }

  async function handleTitleCommit(child: Task, nextTitle: string): Promise<void> {
    await updateTask(child.id, { title: nextTitle });
    notify();
  }

  async function handleDelete(child: Task): Promise<void> {
    await deleteTaskCascade(child.id);
    notify();
  }

  async function handleAdd(): Promise<void> {
    await createChildTask(parentId, "新子任务");
    notify();
  }

  const showAddButton = mode !== "readonly";

  const addButton = showAddButton ? (
    <li>
      <button
        type="button"
        aria-label="添加子任务"
        onClick={() => void handleAdd()}
        className="min-h-8 text-xs text-ink-3 hover:text-ink-2"
      >
        + 子任务
      </button>
    </li>
  ) : null;

  if (mode === "readonly") {
    return (
      <ul className="space-y-1">
        {children.map((child) => (
          <ReadonlyChildRow key={child.id} child={child} />
        ))}
      </ul>
    );
  }

  if (mode === "static") {
    return (
      <ul className="space-y-1">
        {children.map((child) => (
          <StaticChildRow
            key={child.id}
            child={child}
            onToggleDone={(c) => void handleToggle(c)}
            onTitleCommit={(c, t) => void handleTitleCommit(c, t)}
            onDelete={(c) => void handleDelete(c)}
          />
        ))}
        {addButton}
      </ul>
    );
  }

  return (
    <SortableContext items={children.map((child) => child.id)} strategy={verticalListSortingStrategy}>
      <ul className="space-y-1">
        {children.map((child) => (
          <SortableChildRow
            key={child.id}
            child={child}
            onToggleDone={(c) => void handleToggle(c)}
            onTitleCommit={(c, t) => void handleTitleCommit(c, t)}
            onDelete={(c) => void handleDelete(c)}
          />
        ))}
        {addButton}
      </ul>
    </SortableContext>
  );
}