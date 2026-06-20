import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task } from "@timedata/shared";
import { useState } from "react";
import {
  createChildTask,
  deleteTaskCascade,
  toggleTaskDone,
  updateTask,
} from "../../lib/tasks.js";
import { NewChildRow, ReadonlyChildRow, SortableChildRow, StaticChildRow } from "./SortableChildRow.js";
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
 * 新增子任务走「草稿行」：点 +子任务 或在某条子任务上回车，都会在末尾打开一条空白聚焦输入框，
 * 不预填充占位文案；输入为空不落库。不渲染 recurrence/tags/turn/scheduledAt 入口——子任务隐藏高级控件。
 */
export function InlineChildren({ parentId, mode, onAfterWrite }: InlineChildrenProps) {
  const children = useTaskChildren(parentId);
  const [drafting, setDrafting] = useState(false);

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

  // 草稿解析：空标题不落库（schema 拒空，宿主先拦）；回车提交非空后保持草稿继续录入，失焦或空回车则收起。
  async function resolveDraft(title: string, source: "enter" | "blur"): Promise<void> {
    const trimmed = title.trim();
    if (trimmed) {
      await createChildTask(parentId, trimmed);
      notify();
    }
    if (!(source === "enter" && trimmed)) {
      setDrafting(false);
    }
  }

  if (mode === "readonly") {
    return (
      <ul className="space-y-1">
        {children.map((child) => (
          <ReadonlyChildRow key={child.id} child={child} />
        ))}
      </ul>
    );
  }

  const rows = children.map((child) =>
    mode === "static" ? (
      <StaticChildRow
        key={child.id}
        child={child}
        onToggleDone={(c) => void handleToggle(c)}
        onTitleCommit={(c, t) => void handleTitleCommit(c, t)}
        onDelete={(c) => void handleDelete(c)}
        onEnter={() => setDrafting(true)}
      />
    ) : (
      <SortableChildRow
        key={child.id}
        child={child}
        onToggleDone={(c) => void handleToggle(c)}
        onTitleCommit={(c, t) => void handleTitleCommit(c, t)}
        onDelete={(c) => void handleDelete(c)}
        onEnter={() => setDrafting(true)}
      />
    ),
  );

  // 稳定 key：新增子任务时草稿行不随行数变化而重挂载，保住焦点与软键盘。
  const draftRow = drafting ? (
    <li key="__draft__">
      <NewChildRow onResolve={(t, s) => void resolveDraft(t, s)} />
    </li>
  ) : null;

  const addButton = !drafting ? (
    <li key="__add__">
      <button
        type="button"
        aria-label="添加子任务"
        onClick={() => setDrafting(true)}
        className="min-h-8 text-xs text-ink-3 hover:text-ink-2"
      >
        + 子任务
      </button>
    </li>
  ) : null;

  if (mode === "static") {
    return (
      <ul className="space-y-1">
        {rows}
        {draftRow}
        {addButton}
      </ul>
    );
  }

  return (
    <SortableContext items={children.map((child) => child.id)} strategy={verticalListSortingStrategy}>
      <ul className="space-y-1">
        {rows}
        {draftRow}
        {addButton}
      </ul>
    </SortableContext>
  );
}
