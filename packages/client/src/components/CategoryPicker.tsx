import { useEffect, useState } from "react";
import { useCategories } from "../hooks/useCategories.ts";

interface CategoryPickerProps {
  onSelect: (categoryId: string) => void;
  selectedId?: string;
}

export default function CategoryPicker({ onSelect, selectedId }: CategoryPickerProps) {
  const { parentCategories, getChildren } = useCategories();
  const [activeParentId, setActiveParentId] = useState<string | null>(null);
  const activeParent = parentCategories.find((parent) => parent.id === activeParentId) || parentCategories[0];
  const activeChildren = activeParent ? getChildren(activeParent.id) : [];

  useEffect(() => {
    if (activeParentId || parentCategories.length === 0) return;

    const firstParent = parentCategories[0];
    const firstChild = getChildren(firstParent.id)[0];
    setActiveParentId(firstParent.id);
    if (!selectedId) {
      onSelect(firstChild?.id || firstParent.id);
    }
  }, [activeParentId, getChildren, onSelect, parentCategories, selectedId]);

  useEffect(() => {
    if (!selectedId || parentCategories.length === 0) return;

    const selectedParent = parentCategories.find((parent) => parent.id === selectedId);
    if (selectedParent) {
      setActiveParentId(selectedParent.id);
      return;
    }

    const parent = parentCategories.find((candidate) => getChildren(candidate.id).some((child) => child.id === selectedId));
    if (parent) {
      setActiveParentId(parent.id);
    }
  }, [getChildren, parentCategories, selectedId]);

  if (parentCategories.length === 0) {
    return <div className="rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-500">还没有分类，请先在分类页添加。</div>;
  }

  function chooseParent(parentId: string) {
    setActiveParentId(parentId);
    const firstChild = getChildren(parentId)[0];
    onSelect(firstChild?.id || parentId);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {parentCategories.map((parent) => {
          const selected = activeParent?.id === parent.id;
          return (
            <button
              type="button"
              key={parent.id}
              onClick={() => chooseParent(parent.id)}
              className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium transition-all ${
                selected ? "ring-2 ring-offset-1 ring-offset-slate-900" : "opacity-80 hover:opacity-100"
              }`}
              style={{
                backgroundColor: selected ? parent.color : `${parent.color}22`,
                color: selected ? "#0f172a" : parent.color,
              }}
            >
              {parent.name}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {(activeChildren.length > 0 ? activeChildren : activeParent ? [activeParent] : []).map((category) => {
          const selected = selectedId === category.id;
          const color = activeParent?.color || category.color;
          return (
            <button
              type="button"
              key={category.id}
              onClick={() => onSelect(category.id)}
              className={`rounded-full px-3 py-2 text-sm transition-all ${
                selected ? "font-semibold ring-2 ring-offset-1 ring-offset-slate-900" : "opacity-85 hover:opacity-100"
              }`}
              style={{
                backgroundColor: selected ? color : `${color}20`,
                color: selected ? "#0f172a" : color,
                border: `1px solid ${color}55`,
              }}
            >
              {category.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
