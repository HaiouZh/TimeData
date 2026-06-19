import { useDroppable } from "@dnd-kit/core";

/**
 * 拖拽悬停激活后，目标根任务行下方临时出现的子任务落点区。
 * 只在被 hover-intent 激活（dropActive）时挂载，因此其 droppable 只在该期间存在，
 * 不干扰常规重排。`containerId` 用 `parent:<id>`，与子任务行同域，
 * 顶层 handler 据此把松手解析成 move-to-parent（即便目标原本没有子任务也成立）。
 */
export function ParentDropZone({ parentId }: { parentId: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `parent-zone:${parentId}`,
    data: { containerId: `parent:${parentId}` },
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="parent-drop-zone"
      aria-hidden="true"
      className={`mt-1 rounded-row border border-dashed px-2 py-2 text-center text-xs transition-colors ${
        isOver ? "border-accent bg-surface-hover text-ink-2" : "border-border-hairline text-ink-3"
      }`}
    >
      松手设为子任务
    </div>
  );
}
