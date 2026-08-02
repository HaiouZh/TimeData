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
  freezeShift = false,
  children,
}: {
  id: string;
  containerId: "pool:today" | "pool:inbox" | "hand";
  /**
   * 缩进态下（`indentTargetId` 命中某一行）冻结本行的避让位移：`verticalListSortingStrategy`
   * 认为「要插到这儿」而让开，与高亮环表达的「钻到它底下当子任务」是两个互相打架的反馈
   * （用户原话：「拖到父任务上会躲」）。冻结只去掉 transform/transition，高亮环（`indentTargetActive`）
   * 不受影响，仍由 TaskRow 画。
   *
   * `!isDragging` 时才冻结：被拖的那一行必须保留 transform，否则连自己都不跟手了。
   */
  freezeShift?: boolean;
  children: (handle: RowDragHandle) => ReactNode;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { containerId },
  });
  const shouldFreeze = freezeShift && !isDragging;
  const style: CSSProperties = {
    // transition 一并去掉：冻结/恢复各只是一次 style 切换，留着 transition 会在两个状态间补一次动画。
    transform: shouldFreeze ? undefined : CSS.Transform.toString(transform),
    transition: shouldFreeze ? undefined : transition,
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