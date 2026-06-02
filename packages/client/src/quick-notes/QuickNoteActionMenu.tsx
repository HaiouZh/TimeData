export interface QuickNoteActionMenuProps {
  x: number;
  y: number;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 140;
const MENU_HEIGHT = 136;

export default function QuickNoteActionMenu({
  x,
  y,
  onCopy,
  onEdit,
  onDelete,
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
        className="absolute min-w-[120px] overflow-hidden rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => run(onCopy)}
          className="block w-full px-4 py-2 text-left text-sm text-slate-100 hover:bg-slate-700"
        >
          复制
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => run(onEdit)}
          className="block w-full px-4 py-2 text-left text-sm text-slate-100 hover:bg-slate-700"
        >
          编辑
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => run(onDelete)}
          className="block w-full px-4 py-2 text-left text-sm text-red-300 hover:bg-slate-700"
        >
          删除
        </button>
      </div>
    </div>
  );
}
