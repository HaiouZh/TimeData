import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@timedata/shared";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Trash } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import { Checkbox } from "../../components/ui/Checkbox.js";

export interface ChildRowCallbacks {
  onToggleDone: (child: Task) => void;
  onTitleCommit: (child: Task, nextTitle: string) => void;
  onDelete: (child: Task) => void;
  onEnter?: (child: Task) => void;
  onBeginEdit?: (child: Task) => void;
  onCancelEdit?: (child: Task) => void;
}

interface ChildRowBodyProps extends ChildRowCallbacks {
  child: Task;
  readonly: boolean;
  editing?: boolean;
  /** 覆盖勾态显示；缺省读 child.done。 */
  doneOverride?: boolean;
  /** 无可映射 occurrence 时置灰复选框。 */
  toggleDisabled?: boolean;
}

function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.overflowY = "hidden";
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function useAutoGrowingTextarea() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastObservedWidthRef = useRef<number | null>(null);
  const grow = useCallback(() => autoGrow(ref.current), []);

  useLayoutEffect(() => {
    grow();
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width =
        entry?.contentRect?.width ??
        (entry?.target instanceof HTMLElement ? entry.target.getBoundingClientRect().width : null);
      if (width !== null && entry?.contentRect) {
        if (lastObservedWidthRef.current === width) return;
        lastObservedWidthRef.current = width;
      }
      autoGrow(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  return ref;
}

function hasNonEmptySelection(): boolean {
  return (window.getSelection()?.toString().trim().length ?? 0) > 0;
}

function ChildRowBody({
  child,
  readonly,
  editing = false,
  onToggleDone,
  onTitleCommit,
  onDelete,
  onEnter,
  onBeginEdit,
  onCancelEdit,
  doneOverride,
  toggleDisabled = false,
}: ChildRowBodyProps) {
  const [draft, setDraft] = useState(child.title);
  const lastExternal = useRef(child.title);
  const skipBlurCommitRef = useRef(false);
  const titleRef = useAutoGrowingTextarea();
  const effectiveDone = doneOverride ?? child.done;

  // 外部（同步/其他端）刷新标题时，仅当用户未在编辑（draft 仍等于上次外部值）才同步。
  useEffect(() => {
    if (child.title !== lastExternal.current && draft === lastExternal.current) {
      setDraft(child.title);
    }
    lastExternal.current = child.title;
  }, [child.title, draft]);

  useEffect(() => {
    if (!editing) return;
    skipBlurCommitRef.current = false;
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing, titleRef]);

  function beginEdit(): void {
    if (readonly) return;
    onBeginEdit?.(child);
  }

  function cancelEdit(): void {
    skipBlurCommitRef.current = true;
    setDraft(child.title);
    onCancelEdit?.(child);
  }

  function commitEdit(): void {
    const next = draft.trim();
    if (!next || next === child.title) {
      setDraft(child.title);
      onCancelEdit?.(child);
      return;
    }
    onTitleCommit(child, next);
  }

  function handleEditKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitEdit();
      onEnter?.(child);
    }
  }

  function handleTitleKey(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      beginEdit();
    }
  }

  return (
    <div className="group flex items-start gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-hover">
      {!readonly && (
        <Checkbox
          ariaLabel={`完成子任务 ${child.title}`}
          checked={effectiveDone}
          onChange={() => onToggleDone(child)}
          disabled={toggleDisabled}
          className="shrink-0"
          dense
        />
      )}
      {readonly ? (
        <span
          className={`min-h-8 min-w-0 flex-1 break-words px-1 py-1 td-text-body ${effectiveDone ? "text-ink-3 line-through" : "text-ink"}`}
        >
          {child.title}
        </span>
      ) : editing ? (
        // 与展示态同高同心（紧凑档 min-h-8 对齐复选框热区），进出编辑不跳动
        <span className="flex min-h-8 min-w-0 flex-1 items-center">
          <textarea
            aria-label="子任务标题"
            value={draft}
            rows={1}
            ref={titleRef}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              autoGrow(event.currentTarget);
            }}
            onBlur={() => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
              }
              commitEdit();
            }}
            onKeyDown={handleEditKey}
            className={`min-w-0 flex-1 resize-none break-words bg-transparent px-1 py-1 td-text-body outline-none focus:bg-surface-hover ${
              effectiveDone ? "text-ink-3 line-through" : "text-ink"
            }`}
          />
        </span>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: 按钮元素会截断浏览器选区，跨子任务划选复制要求标题是真文字节点
        <span
          role="button"
          tabIndex={0}
          data-testid={`child-title-${child.id}`}
          aria-label={`编辑子任务 ${child.title}`}
          onClick={() => {
            if (hasNonEmptySelection()) return;
            beginEdit();
          }}
          onKeyDown={handleTitleKey}
          className={`flex min-h-8 min-w-0 flex-1 cursor-text select-text items-center break-words px-1 py-1 text-left td-text-body font-normal outline-none focus:bg-surface-hover ${
            effectiveDone ? "text-ink-3 line-through" : "text-ink"
          }`}
        >
          {child.title}
        </span>
      )}
      {!readonly && (
        <button
          type="button"
          aria-label={`删除子任务 ${child.title}`}
          onClick={() => onDelete(child)}
          className="flex min-h-8 shrink-0 items-center rounded-ctl px-1 text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Icon icon={Trash} size={14} />
        </button>
      )}
    </div>
  );
}

export interface SortableChildRowProps extends ChildRowCallbacks {
  child: Task;
  editing?: boolean;
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
    <li
      ref={setNodeRef}
      style={style}
      // 拖拽中高亮选中框：ring 用 inset，外侧 box-shadow 会被滑动容器 overflow 裁掉
      className={`group flex items-start gap-1 rounded-lg ${isDragging ? "bg-surface-hover ring-1 ring-inset ring-accent" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <ChildRowBody {...props} readonly={false} />
      </div>
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`拖动子任务 ${child.title}`}
        // my-0.5 补齐 ChildRowBody 容器的 py-0.5，使中线与复选框/标题一致
        className="my-0.5 flex min-h-8 shrink-0 cursor-grab touch-none select-none items-center rounded px-2 text-ink-3 opacity-80 hover:bg-surface-hover hover:text-ink-2 group-hover:opacity-100 active:cursor-grabbing"
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
  editing?: boolean;
  doneOverride?: boolean;
  toggleDisabled?: boolean;
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
      <ChildRowBody child={child} readonly onToggleDone={noop} onTitleCommit={noop} onDelete={noop} />
    </li>
  );
}

export interface NewChildRowProps {
  /** 提交草稿标题；source=enter 表示回车提交（提交后宿主保持草稿继续录入），空标题视为放弃。 */
  onResolve: (title: string, source: "enter" | "blur") => void;
}

/**
 * 草稿行：空白聚焦输入框，用于新建子任务——不预填充任何占位文案。
 * 空标题不落库（交由宿主 + schema 共同拒空）。
 */
export function NewChildRow({ onResolve }: NewChildRowProps) {
  const [draft, setDraft] = useState("");
  const ref = useAutoGrowingTextarea();

  // 挂载即聚焦：紧随用户手势的程序化聚焦在 APK(WebView) 上会唤起软键盘；桌面端等同于光标进入输入框。
  useEffect(() => {
    const el = ref.current;
    el?.focus();
  }, [ref]);

  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const value = draft;
      setDraft("");
      autoGrow(ref.current);
      onResolve(value, "enter");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft("");
      onResolve("", "blur");
    }
  }

  return (
    <li className="group flex items-start gap-1">
      <div className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1 py-0.5">
        {/* 占位与已有子任务行的复选框对齐 */}
        <span aria-hidden="true" className="mt-1.5 h-4 w-4 shrink-0" />
        <textarea
          ref={ref}
          aria-label="新子任务标题"
          value={draft}
          rows={1}
          placeholder="新子任务…"
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            autoGrow(event.currentTarget);
          }}
          onBlur={() => onResolve(draft, "blur")}
          onKeyDown={handleKey}
          className="min-h-8 min-w-0 flex-1 resize-none break-words bg-transparent px-1 py-1 text-sm text-ink outline-none focus:bg-surface-hover"
        />
      </div>
    </li>
  );
}
