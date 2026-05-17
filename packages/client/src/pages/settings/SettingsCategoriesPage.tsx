import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import SortableCategoryItem from "../../components/SortableCategoryItem.tsx";
import { useCategories } from "../../hooks/useCategories.ts";
import {
  CATEGORY_COLOR_PALETTES,
  type CategoryColorPaletteId,
} from "../../lib/categoryColors.ts";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

export default function SettingsCategoriesPage() {
  const {
    parentCategories,
    getChildren,
    addCategory,
    applyCategoryPalette,
    reorderCategories,
  } = useCategories();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#4A90D9");
  const [addError, setAddError] = useState<string | null>(null);
  const [paletteDialogOpen, setPaletteDialogOpen] = useState(false);
  const [oneClickPalette, setOneClickPalette] = useState<CategoryColorPaletteId>("classic");
  const [colorError, setColorError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const parentIds = useMemo(() => parentCategories.map((parent) => parent.id), [parentCategories]);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;

    try {
      await addCategory(name, null, newColor);
      setNewName("");
      setNewColor("#4A90D9");
      setAddError(null);
      setAdding(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "新增分类失败。");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const oldIndex = parentIds.indexOf(activeId);
    const newIndex = parentIds.indexOf(overId);

    if (oldIndex === -1 || newIndex === -1) return;

    await reorderCategories(null, arrayMove(parentIds, oldIndex, newIndex));
  }

  async function handleApplyPalette() {
    try {
      await applyCategoryPalette(oneClickPalette);
      setPaletteDialogOpen(false);
      setColorError(null);
    } catch (error) {
      setColorError(error instanceof Error ? error.message : "一键配色失败。");
    }
  }

  return (
    <SettingsDetailPage title="分类">
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => setPaletteDialogOpen(true)} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700">
          一键配色
        </button>
        <button type="button" onClick={() => setAdding(true)} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500">
          + 新增分类
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={parentIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {parentCategories.map((parent) => {
              const childCount = getChildren(parent.id).length;

              return (
                <SortableCategoryItem
                  key={parent.id}
                  id={parent.id}
                  dragLabel={`拖动分类 ${parent.name}`}
                  className="flex items-stretch overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/settings/categories/${parent.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left text-slate-100 hover:bg-slate-800/70"
                    style={{ borderLeft: `4px solid ${parent.color}` }}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: parent.color }} />
                    <span className="min-w-0 flex-1 truncate font-medium">{parent.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{childCount} 个子分类</span>
                    <span className="shrink-0 text-slate-500">›</span>
                  </button>
                </SortableCategoryItem>
              );
            })}
            {parentCategories.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
                暂无分类，点击新增分类开始创建。
              </div>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAdding(false)}>
          <div className="w-80 space-y-3 rounded-xl bg-slate-900 p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-medium">新增分类</h3>
            <input
              type="text"
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                setAddError(null);
              }}
              placeholder="分类名称"
              className="w-full rounded bg-slate-800 px-3 py-2 text-sm"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-400">颜色</label>
              <input type="color" aria-label="分类颜色" value={newColor} onChange={(event) => setNewColor(event.target.value)} className="h-8 w-8" />
            </div>
            {addError && <p className="text-sm text-red-400">{addError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={handleAdd} className="flex-1 rounded bg-blue-600 py-2 text-sm hover:bg-blue-500">添加</button>
              <button type="button" onClick={() => setAdding(false)} className="rounded bg-slate-800 px-4 py-2 text-sm">取消</button>
            </div>
          </div>
        </div>
      )}

      {paletteDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPaletteDialogOpen(false)}>
          <div className="w-96 space-y-4 rounded-xl bg-slate-900 p-5" onClick={(event) => event.stopPropagation()}>
            <h3 className="font-medium">一键配色</h3>
            <p className="text-sm text-slate-400">将按当前一级分类顺序循环应用配色方案，子分类会跟随父分类颜色。</p>
            <div className="space-y-2">
              {(Object.keys(CATEGORY_COLOR_PALETTES) as CategoryColorPaletteId[]).map((paletteId) => (
                <button
                  key={paletteId}
                  type="button"
                  onClick={() => setOneClickPalette(paletteId)}
                  className={`w-full rounded-lg p-3 text-left ${oneClickPalette === paletteId ? "bg-blue-600/40 ring-1 ring-blue-400" : "bg-slate-800 hover:bg-slate-700"}`}
                >
                  <div className="mb-2 text-sm">{CATEGORY_COLOR_PALETTES[paletteId].label}</div>
                  <div className="flex h-3 overflow-hidden rounded">
                    {CATEGORY_COLOR_PALETTES[paletteId].colors.map((color) => (
                      <span key={color} className="flex-1" style={{ backgroundColor: color }} />
                    ))}
                  </div>
                </button>
              ))}
            </div>
            <div className="space-y-1">
              {parentCategories.slice(0, 6).map((category, index) => (
                <div key={category.id} className="flex items-center gap-2 text-sm text-slate-300">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: CATEGORY_COLOR_PALETTES[oneClickPalette].colors[index % CATEGORY_COLOR_PALETTES[oneClickPalette].colors.length] }} />
                  <span>{category.name}</span>
                </div>
              ))}
              {parentCategories.length > 6 && <p className="text-xs text-slate-500">还有 {parentCategories.length - 6} 个一级分类会继续循环配色。</p>}
            </div>
            {colorError && <p className="text-sm text-red-400">{colorError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={handleApplyPalette} disabled={parentCategories.length === 0} className="flex-1 rounded bg-blue-600 py-2 text-sm hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400">应用</button>
              <button type="button" onClick={() => setPaletteDialogOpen(false)} className="rounded bg-slate-800 px-4 py-2 text-sm">取消</button>
            </div>
          </div>
        </div>
      )}
    </SettingsDetailPage>
  );
}
