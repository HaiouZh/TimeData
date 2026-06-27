import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Category } from "@timedata/shared";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SortableCategoryItem from "../../components/SortableCategoryItem.tsx";
import { useCategories } from "../../hooks/useCategories.ts";
import { CATEGORY_COLOR_PALETTES, type CategoryColorPaletteId } from "../../lib/categoryColors.ts";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

interface DeletingCategoryState {
  category: Category;
  childCount: number;
  entryCount: number;
}

export default function SettingsCategoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    parentCategories,
    getChildren,
    addCategory,
    renameCategory,
    updateCategoryColor,
    deleteCategory,
    getCategoryDeleteImpact,
    reorderCategories,
  } = useCategories();
  const category = parentCategories.find((parent) => parent.id === id);
  const children = category ? getChildren(category.id) : [];
  const childIds = children.map((child) => child.id);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [colorEditing, setColorEditing] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string>(CATEGORY_COLOR_PALETTES.classic.colors[0]);
  const [selectedPalette, setSelectedPalette] = useState<CategoryColorPaletteId>("classic");
  const [colorError, setColorError] = useState<string | null>(null);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [childAddError, setChildAddError] = useState<string | null>(null);
  const [renamingChild, setRenamingChild] = useState<{ id: string; name: string } | null>(null);
  const [childRenameName, setChildRenameName] = useState("");
  const [childRenameError, setChildRenameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DeletingCategoryState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function openEditName() {
    if (!category) return;
    setEditingName(true);
    setNameValue(category.name);
    setNameError(null);
  }

  async function handleSaveName() {
    if (!category) return;

    try {
      await renameCategory(category.id, nameValue);
      setEditingName(false);
      setNameError(null);
    } catch (error) {
      setNameError(error instanceof Error ? error.message : "重命名失败。");
    }
  }

  function openColorEditor() {
    if (!category) return;
    setColorEditing(true);
    setSelectedColor(category.color);
    setColorError(null);
  }

  async function handleSaveColor() {
    if (!category) return;

    try {
      await updateCategoryColor(category.id, selectedColor);
      setColorEditing(false);
      setColorError(null);
    } catch (error) {
      setColorError(error instanceof Error ? error.message : "保存颜色失败。");
    }
  }

  async function handleAddChild() {
    if (!category) return;
    const name = childName.trim();
    if (!name) return;

    try {
      await addCategory(name, category.id, category.color);
      setChildName("");
      setChildAddError(null);
      setAddingChild(false);
    } catch (error) {
      setChildAddError(error instanceof Error ? error.message : "新增子分类失败。");
    }
  }

  function openRenameChild(child: { id: string; name: string }) {
    setRenamingChild({ id: child.id, name: child.name });
    setChildRenameName(child.name);
    setChildRenameError(null);
  }

  async function handleRenameChild() {
    if (!renamingChild) return;

    try {
      await renameCategory(renamingChild.id, childRenameName);
      setRenamingChild(null);
      setChildRenameName("");
      setChildRenameError(null);
    } catch (error) {
      setChildRenameError(error instanceof Error ? error.message : "重命名失败。");
    }
  }

  async function openDelete(target: Category) {
    try {
      const impact = await getCategoryDeleteImpact(target.id);
      setDeleting({ category: target, childCount: impact.childCount, entryCount: impact.entryCount });
      setDeleteError(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "读取删除影响失败。");
    }
  }

  async function handleDelete() {
    if (!deleting) return;

    try {
      await deleteCategory(deleting.category.id);
      const deletedCurrentCategory = deleting.category.id === category?.id;
      setDeleting(null);
      setDeleteError(null);
      if (deletedCurrentCategory) {
        navigate("/settings/categories");
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除分类失败。");
    }
  }

  async function handleChildDragEnd(event: DragEndEvent) {
    if (!category) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const oldIndex = childIds.indexOf(activeId);
    const newIndex = childIds.indexOf(overId);

    if (oldIndex === -1 || newIndex === -1) return;

    await reorderCategories(category.id, arrayMove(childIds, oldIndex, newIndex));
  }

  function deleteMessage() {
    if (!deleting) return "";
    if (!deleting.category.parentId && deleting.childCount > 0) {
      return `删除一级分类「${deleting.category.name}」将同时删除 ${deleting.childCount} 个子分类和 ${deleting.entryCount} 条时间记录，此操作不可撤销。确定继续？`;
    }
    if (deleting.entryCount > 0) {
      return `删除分类「${deleting.category.name}」将同时删除 ${deleting.entryCount} 条时间记录，此操作不可撤销。确定继续？`;
    }
    return `确定删除分类「${deleting.category.name}」？此操作不可撤销。`;
  }

  if (!category) {
    return (
      <SettingsDetailPage title="分类不存在" backTo="/settings/categories" backLabel="返回分类">
        <p className="text-sm text-ink-3">该分类不存在或已被删除。</p>
      </SettingsDetailPage>
    );
  }

  return (
    <SettingsDetailPage title={category.name} backTo="/settings/categories" backLabel="返回分类">
      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <h3 className="text-sm font-medium text-ink-3">基本信息</h3>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-ink-2">名称</span>
          <button
            type="button"
            onClick={openEditName}
            className="min-w-0 truncate text-sm text-accent hover:text-accent-ink"
          >
            {category.name}
          </button>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-ink-2">颜色</span>
          <button type="button" onClick={openColorEditor} className="flex items-center gap-2">
            <span
              className="h-5 w-5 rounded-full border border-border"
              style={{ backgroundColor: category.color }}
            />
            <span className="text-sm text-accent hover:text-accent-ink">修改</span>
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-medium text-ink-3">子分类</h3>
          <button
            type="button"
            onClick={() => {
              setAddingChild(true);
              setChildAddError(null);
            }}
            className="text-sm text-accent hover:text-accent-ink"
          >
            + 新增
          </button>
        </div>
        {children.length === 0 && <p className="text-sm text-ink-3">暂无子分类。</p>}
        {children.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleChildDragEnd}>
            <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {children.map((child) => (
                  <SortableCategoryItem
                    key={child.id}
                    id={child.id}
                    dragLabel={`拖动子分类 ${child.name}`}
                    className="flex items-center rounded-lg bg-surface-elevated px-2 py-2"
                  >
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => openRenameChild(child)}
                        className="min-w-0 truncate text-sm text-ink-2 hover:text-accent-ink"
                      >
                        {child.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => openDelete(child)}
                        className="shrink-0 text-xs text-danger hover:text-danger/80"
                      >
                        删除
                      </button>
                    </div>
                  </SortableCategoryItem>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-danger/40 bg-danger-soft p-4">
        <h3 className="text-sm font-medium text-danger">危险操作</h3>
        <button
          type="button"
          onClick={() => openDelete(category)}
          className="w-full rounded bg-danger py-2 text-sm font-medium text-page hover:bg-danger/80"
        >
          删除分类
        </button>
        {deleteError && !deleting && <p className="text-sm text-danger">{deleteError}</p>}
      </section>

      {editingName && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setEditingName(false)}
        >
          <div className="w-80 space-y-3 rounded-xl bg-surface-elevated p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-medium">重命名分类</h3>
            <input
              type="text"
              value={nameValue}
              onChange={(event) => {
                setNameValue(event.target.value);
                setNameError(null);
              }}
              placeholder="分类名称"
              className="w-full rounded bg-surface px-3 py-2 text-sm"
            />
            {nameError && <p className="text-sm text-danger">{nameError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveName}
                className="flex-1 rounded bg-accent py-2 text-sm font-medium text-page hover:bg-accent-strong"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setEditingName(false)}
                className="rounded bg-surface-hover px-4 py-2 text-sm text-ink-2"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {colorEditing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setColorEditing(false)}
        >
          <div className="w-96 space-y-4 rounded-xl bg-surface-elevated p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-medium">修改分类颜色</h3>
            <div className="flex items-center gap-3">
              <span
                className="h-8 w-8 rounded-full border border-border"
                style={{ backgroundColor: selectedColor }}
              />
              <span className="text-sm text-ink-2">{category.name}</span>
              <input
                type="color"
                aria-label="分类颜色"
                value={selectedColor}
                onChange={(event) => setSelectedColor(event.target.value)}
                className="ml-auto h-8 w-10"
              />
            </div>
            <div className="flex gap-2">
              {(Object.keys(CATEGORY_COLOR_PALETTES) as CategoryColorPaletteId[]).map((paletteId) => (
                <button
                  key={paletteId}
                  type="button"
                  onClick={() => setSelectedPalette(paletteId)}
                  className={`rounded px-3 py-1 text-sm ${selectedPalette === paletteId ? "bg-accent text-page" : "bg-surface-hover text-ink-2 hover:bg-surface"}`}
                >
                  {CATEGORY_COLOR_PALETTES[paletteId].label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {CATEGORY_COLOR_PALETTES[selectedPalette].colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`选择颜色 ${color}`}
                  onClick={() => setSelectedColor(color)}
                  className={`h-8 w-8 rounded-full border ${selectedColor.toUpperCase() === color ? "border-ink" : "border-border"}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            {colorError && <p className="text-sm text-danger">{colorError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveColor}
                className="flex-1 rounded bg-accent py-2 text-sm font-medium text-page hover:bg-accent-strong"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setColorEditing(false)}
                className="rounded bg-surface-hover px-4 py-2 text-sm text-ink-2"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {addingChild && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setAddingChild(false)}
        >
          <div className="w-80 space-y-3 rounded-xl bg-surface-elevated p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-medium">添加子分类</h3>
            <input
              type="text"
              value={childName}
              onChange={(event) => {
                setChildName(event.target.value);
                setChildAddError(null);
              }}
              placeholder="子分类名称"
              className="w-full rounded bg-surface px-3 py-2 text-sm"
            />
            {childAddError && <p className="text-sm text-danger">{childAddError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddChild}
                className="flex-1 rounded bg-accent py-2 text-sm font-medium text-page hover:bg-accent-strong"
              >
                添加
              </button>
              <button
                type="button"
                onClick={() => setAddingChild(false)}
                className="rounded bg-surface-hover px-4 py-2 text-sm text-ink-2"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {renamingChild && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setRenamingChild(null)}
        >
          <div className="w-80 space-y-3 rounded-xl bg-surface-elevated p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-medium">重命名子分类</h3>
            <input
              type="text"
              value={childRenameName}
              onChange={(event) => {
                setChildRenameName(event.target.value);
                setChildRenameError(null);
              }}
              placeholder="子分类名称"
              className="w-full rounded bg-surface px-3 py-2 text-sm"
            />
            {childRenameError && <p className="text-sm text-danger">{childRenameError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRenameChild}
                className="flex-1 rounded bg-accent py-2 text-sm font-medium text-page hover:bg-accent-strong"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setRenamingChild(null)}
                className="rounded bg-surface-hover px-4 py-2 text-sm text-ink-2"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setDeleting(null)}
        >
          <div className="w-96 space-y-3 rounded-xl bg-surface-elevated p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-medium text-danger">删除分类</h3>
            <p className="text-sm leading-6 text-ink-2">{deleteMessage()}</p>
            {deleteError && <p className="text-sm text-danger">{deleteError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 rounded bg-danger py-2 text-sm font-medium text-page hover:bg-danger/80"
              >
                确认删除
              </button>
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="rounded bg-surface-hover px-4 py-2 text-sm text-ink-2"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsDetailPage>
  );
}
