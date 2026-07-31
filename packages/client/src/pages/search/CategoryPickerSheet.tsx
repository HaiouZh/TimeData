import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { Category } from "@timedata/shared";
import { type MouseEvent as ReactMouseEvent, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { rowClickZone } from "../../lib/tasks/taskRowZone.ts";

export interface CategoryPickerSheetProps {
  parentCategories: Category[];
  getChildren: (parentId: string) => Category[];
  selectedId: string | null;
  onSelect: (categoryId: string | null) => void;
  onClose: () => void;
}

const ROW_BASE =
  "flex min-h-11 w-full items-center gap-2 rounded-row px-3 text-left td-text-body text-ink transition hover:bg-surface-hover";

export function CategoryPickerSheet({
  parentCategories,
  getChildren,
  selectedId,
  onSelect,
  onClose,
}: CategoryPickerSheetProps) {
  // 打开时展开「已选分类」所在的父：没有这条，选子分类恒为两次点击，折叠就白折腾了。
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (!selectedId) return new Set();
    const owner = parentCategories.find(
      (parent) => parent.id === selectedId || getChildren(parent.id).some((child) => child.id === selectedId),
    );
    return owner ? new Set([owner.id]) : new Set();
  });

  function choose(categoryId: string | null): void {
    onSelect(categoryId);
    onClose();
  }

  function toggleExpanded(parentId: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }

  function handleParentClick(event: ReactMouseEvent<HTMLDivElement>, parent: Category, hasChildren: boolean): void {
    if (!hasChildren) {
      choose(parent.id);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    // 与 ToDo 行同一套分区：左 2/5 进入下一层，右 3/5 是该行主动作。
    if (rowClickZone(event.clientX - rect.left, rect.width) === "expand") {
      toggleExpanded(parent.id);
      return;
    }
    choose(parent.id);
  }

  return (
    <div className="max-h-[calc(70vh)] overflow-y-auto rounded-card border border-border bg-surface p-2 shadow-elev1">
      <div
        data-category-row="全部分类"
        role="button"
        tabIndex={0}
        aria-label="全部分类"
        className={`${ROW_BASE} ${selectedId === null ? "bg-accent-soft text-accent" : ""}`}
        onClick={() => choose(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") choose(null);
        }}
      >
        全部分类
      </div>

      {parentCategories.map((parent) => {
        const children = getChildren(parent.id);
        const hasChildren = children.length > 0;
        const isOpen = expanded.has(parent.id);

        return (
          <div key={parent.id}>
            <div
              data-category-row={parent.name}
              role="button"
              tabIndex={0}
              aria-label={hasChildren ? `${parent.name}（左侧展开子分类，右侧选中）` : parent.name}
              className={`${ROW_BASE} ${selectedId === parent.id ? "bg-accent-soft text-accent" : ""}`}
              onClick={(event) => handleParentClick(event, parent, hasChildren)}
              onKeyDown={(event) => {
                if (event.key === "Enter") choose(parent.id);
              }}
            >
              <span className="w-4 shrink-0 text-ink-3">
                {hasChildren && <Icon icon={isOpen ? CaretDown : CaretRight} size={14} />}
              </span>
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-pill"
                style={{ backgroundColor: parent.color }}
              />
              <span className="truncate">{parent.name}</span>
            </div>

            {isOpen &&
              children.map((child) => (
                <div
                  key={child.id}
                  data-category-row={child.name}
                  role="button"
                  tabIndex={0}
                  aria-label={`${parent.name} · ${child.name}`}
                  className={`${ROW_BASE} pl-11 ${selectedId === child.id ? "bg-accent-soft text-accent" : ""}`}
                  onClick={() => choose(child.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") choose(child.id);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-pill"
                    style={{ backgroundColor: parent.color }}
                  />
                  <span className="truncate">{child.name}</span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
