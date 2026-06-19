import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Task } from "@timedata/shared";
import { useState } from "react";
import {
  createChildTask,
  deleteTaskCascade,
  persistTaskOrder,
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
 * - draggable：完整交互（勾选/编辑/拖拽/删除/新增）。
 * - static：可勾选/编辑/删除/新增，但不参与拖拽（已排期）。
 * - readonly：纯展示快照，无任何写入入口（已完成 occurrence）。
 *
 * 不渲染 recurrence/tags/turn/scheduledAt 入口——子任务隐藏高级控件。
 */
export function InlineChildren({ parentId, mode, onAfterWrite }: InlineChildrenProps) {
  const children = useTaskChildren(parentId);

  async function notify(): Promise<void> {
    onAfterWrite?.();
  }

  async function handleToggle(child: Task): Promise<void> {
    await toggleTaskDone(child.id);
    await notify();
  }

  async function handleTitleCommit(child: Task, nextTitle: string): Promise<void> {
    await updateTask(child.id, { title: nextTitle });
    await notify();
  }

  async function handleDelete(child: Task): Promise<void> {
    await deleteTaskCascade(child.id);
    await notify();
  }

  async function handleAdd(): Promise<void> {
    await createChildTask(parentId, "新子任务");
    await notify();
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
    <DraggableChildren
      parentId={parentId}
      children={children}
      onToggle={handleToggle}
      onTitleCommit={handleTitleCommit}
      onDelete={handleDelete}
      onAfterWrite={notify}
      addButton={addButton}
    />
  );
}

interface DraggableChildrenProps {
  parentId: string;
  children: Task[];
  onToggle: (child: Task) => Promise<void>;
  onTitleCommit: (child: Task, nextTitle: string) => Promise<void>;
  onDelete: (child: Task) => Promise<void>;
  onAfterWrite: () => Promise<void>;
  addButton: React.ReactNode;
}

function DraggableChildren({
  children,
  onToggle,
  onTitleCommit,
  onDelete,
  onAfterWrite,
  addButton,
}: DraggableChildrenProps) {
  const [dragging, setDragging] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleDragEnd(event: DragEndEvent): Promise<void> {
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = children.map((child) => child.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const ordered = arrayMove(ids, oldIndex, newIndex);
    await persistTaskOrder(ordered);
    await onAfterWrite();
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={(event) => void handleDragEnd(event)}
    >
      <SortableContext items={children.map((child) => child.id)} strategy={verticalListSortingStrategy}>
        <ul className={`space-y-1 ${dragging ? "todo-dnd-dragging" : ""}`}>
          {children.map((child) => (
            <SortableChildRow
              key={child.id}
              child={child}
              onToggleDone={(c) => void onToggle(c)}
              onTitleCommit={(c, t) => void onTitleCommit(c, t)}
              onDelete={(c) => void onDelete(c)}
            />
          ))}
          {addButton}
        </ul>
      </SortableContext>
    </DndContext>
  );
}