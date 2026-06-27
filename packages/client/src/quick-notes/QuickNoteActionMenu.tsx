export interface QuickNoteActionMenuProps {
  x: number;
  y: number;
  pinned: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSelect: () => void;
  onTogglePin: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 140;
const MENU_HEIGHT = 216;

export default function QuickNoteActionMenu({
  x,
  y,
  pinned,
  onCopy,
  onEdit,
  onDelete,
  onSelect,
  onTogglePin,
  onClose,
}: QuickNoteActionMenuProps) {
  const viewportWidth = typeof window === "undefined" ? 360 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 640 : window.innerHeight;
  const left = Math.max(8, Math.min(x, viewportWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(y, viewportHeight - MENU_HEIGHT - 8));

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        role="menu"
        aria-label="速记操作"
        className="absolute min-w-[120px] overflow-hidden rounded-ctl border border-border bg-surface-elevated py-1 shadow-elev2"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => run(onCopy)}
          className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-surface-hover"
        >
          复制
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => run(onEdit)}
          className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-surface-hover"
        >
          编辑
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => run(onTogglePin)}
          className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-surface-hover"
        >
          {pinned ? "取消置顶" : "置顶"}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => run(onSelect)}
          className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-surface-hover"
        >
          选择
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => run(onDelete)}
          className="block w-full px-4 py-2 text-left text-sm text-danger hover:bg-danger-soft"
        >
          删除
        </button>
      </div>
    </div>
  );
}
