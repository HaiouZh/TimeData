import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@timedata/shared";
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import { Checkbox } from "../../components/ui/Checkbox.js";

export interface ChildRowCallbacks {
  onToggleDone: (child: Task) => void;
  onTitleCommit: (child: Task, nextTitle: string) => void;
  onDelete: (child: Task) => void;
  onEnter?: (child: Task) => void;
}

interface ChildRowBodyProps extends ChildRowCallbacks {
  child: Task;
  readonly: boolean;
}

function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function ChildRowBody({ child, readonly, onToggleDone, onTitleCommit, onDelete, onEnter }: ChildRowBodyProps) {
  const [draft, setDraft] = useState(child.title);
  const lastExternal = useRef(child.title);

  // 外部（同步/其他端）刷新标题时，仅当用户未在编辑（draft 仍等于上次外部值）才同步。
  useEffect(() => {
    if (child.title !== lastExternal.current && draft === lastExternal.current) {
      setDraft(child.title);
    }
    lastExternal.current = child.title;
  }, [child.title, draft]);

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
      onEnter?.(child);
    }
  }

  return (
    <div className="group flex items-start gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-hover">
      {!readonly && (
        <Checkbox
          ariaLabel={`完成子任务 ${child.title}`}
          checked={child.done}
          onChange={() => onToggleDone(child)}
          className="shrink-0"
        />
      )}
      {readonly ? (
        <span
          aria-label={`子任务 ${child.title}`}
          className={`min-h-8 min-w-0 flex-1 break-words px-1 py-1 text-sm ${child.done ? "text-ink-3 line-through" : "text-ink"}`}
        >
          {child.title}
        </span>
      ) : (
        <textarea
          aria-label="子任务标题"
          value={draft}
          rows={1}
          ref={(el) => autoGrow(el)}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            autoGrow(event.currentTarget);
          }}
          onBlur={() => {
            const next = draft.trim();
            if (!next || next === child.title) {
              setDraft(child.title);
              return;
            }
            onTitleCommit(child, next);
          }}
          onKeyDown={handleKey}
          className={`min-h-8 min-w-0 flex-1 resize-none break-words bg-transparent px-1 py-1 text-sm outline-none focus:bg-surface-hover ${
            child.done ? "text-ink-3 line-through" : "text-ink"
          }`}
        />
      )}
      {!readonly && (
        <button
          type="button"
          aria-label={`删除子任务 ${child.title}`}
          onClick={() => onDelete(child)}
          className="shrink-0 rounded-ctl px-1 py-1 text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Icon icon={Trash} size={14} />
        </button>
      )}
    </div>
  );
}

export interface SortableChildRowProps extends ChildRowCallbacks {
  child: Task;
}

/** draggable 模式：包裹 useSortable，带拖柄。 */
export function SortableChildRow(props: SortableChildRowProps) {
  const { child } = props;
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: child.id,
    data: { containerId: `parent:${child.parentId ?? ""}` },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <li ref={setNodeRef} style={style} className="group flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <ChildRowBody {...props} readonly={false} />
      </div>
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`拖动子任务 ${child.title}`}
        className="shrink-0 cursor-grab touch-none select-none rounded px-2 py-1 text-ink-3 opacity-80 hover:bg-surface-hover hover:text-ink-2 group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        ≡
      </button>
    </li>
  );
}

export interface StaticChildRowProps extends ChildRowCallbacks {
  child: Task;
}

/** static 模式：可编辑但无拖柄（已排期池）。 */
export function StaticChildRow(props: StaticChildRowProps) {
  return (
    <li className="group">
      <ChildRowBody {...props} readonly={false} />
    </li>
  );
}

export interface ReadonlyChildRowProps {
  child: Task;
}

/** readonly 模式：只读快照（已完成池）。 */
export function ReadonlyChildRow({ child }: ReadonlyChildRowProps) {
  const noop = () => {};
  return (
    <li className="group">
      <ChildRowBody
        child={child}
        readonly
        onToggleDone={noop}
        onTitleCommit={noop}
        onDelete={noop}
      />
    </li>
  );
}