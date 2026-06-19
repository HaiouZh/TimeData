import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";
import type { RowDragHandle } from "./TaskRow.js";

/**
 * 顶层 DnD 拓扑下的任务行 sortable wrapper。`containerId` 必传，drag end 时
 * 由顶层 handler 通过 `event.active.data.current.containerId` 取出做语义判断。
 */
export function SortableTaskRow({
  id,
  containerId,
  children,
}: {
  id: string;
  containerId: "pool:today" | "pool:inbox";
  children: (handle: RowDragHandle) => ReactNode;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { containerId },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="w-full">
      {children({
        setActivatorNodeRef,
        attributes,
        listeners,
      })}
    </div>
  );
}