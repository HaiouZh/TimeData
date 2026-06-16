import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";
import type { RowDragHandle } from "./TaskRow.js";

export function SortableTaskRow({
  id,
  children,
}: {
  id: string;
  children: (handle: RowDragHandle) => ReactNode;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({
        setActivatorNodeRef,
        attributes,
        listeners,
      })}
    </div>
  );
}
