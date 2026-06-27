import { DotsSixVertical } from "@phosphor-icons/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon.tsx";

interface SortableCategoryItemProps {
  id: string;
  dragLabel: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  handleClassName?: string;
}

export default function SortableCategoryItem({
  id,
  dragLabel,
  children,
  className = "",
  style,
  handleClassName = "",
}: SortableCategoryItemProps) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const sortableStyle: CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    boxShadow: isDragging ? "var(--shadow-elev2)" : style?.boxShadow,
    zIndex: isDragging ? 10 : style?.zIndex,
  };

  return (
    <div ref={setNodeRef} style={sortableStyle} className={className}>
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={dragLabel}
        className={`shrink-0 cursor-grab touch-none select-none rounded px-2 py-1 text-ink-3 hover:bg-surface-hover hover:text-ink active:cursor-grabbing ${handleClassName}`}
        {...attributes}
        {...listeners}
      >
        <Icon icon={DotsSixVertical} size={16} />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
