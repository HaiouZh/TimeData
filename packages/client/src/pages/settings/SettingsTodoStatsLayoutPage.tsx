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
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import SortableCategoryItem from "../../components/SortableCategoryItem.tsx";
import { reorderById } from "../../lib/navOrder.js";
import { useStatsLayoutForKey } from "../../lib/statsLayoutSetting.ts";
import { TODO_STATS_LAYOUT_KEY, TODO_STATS_MODULE_LIST, TODO_STATS_MODULES } from "../stats/todo/todoStatsModules.ts";
import type { TodoStatsModuleId } from "../stats/todo/types.ts";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

export default function SettingsTodoStatsLayoutPage() {
  const { order, hidden, setLayout, reset } = useStatsLayoutForKey<TodoStatsModuleId>(
    TODO_STATS_LAYOUT_KEY,
    TODO_STATS_MODULE_LIST,
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggle = (id: TodoStatsModuleId) => {
    const nextHidden = new Set(hidden);
    if (nextHidden.has(id)) nextHidden.delete(id);
    else nextHidden.add(id);
    setLayout({ order, hidden: order.filter((item) => nextHidden.has(item)) });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const nextOrder = reorderById(order, String(active.id), String(over.id), (id) => id);
    setLayout({ order: nextOrder, hidden: nextOrder.filter((id) => hidden.has(id)) });
  };

  return (
    <SettingsDetailPage title="待办统计页面布局">
      <section className="space-y-3">
        <p className="px-1 td-text-caption text-ink-3">
          调整待办统计页各模块的显示与顺序，设置会跨设备同步。拖动调整顺序。
        </p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {order.map((id) => {
                const module = TODO_STATS_MODULES[id];
                if (!module) return null;
                const isHidden = hidden.has(id);
                return (
                  <SortableCategoryItem
                    key={id}
                    id={id}
                    dragLabel={`拖动 ${module.title}`}
                    className={`flex items-stretch rounded-card border border-border bg-surface ${
                      isHidden ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex w-full min-w-0 items-start justify-between gap-3 p-3 pr-1">
                      <div className="min-w-0">
                        <div className="td-text-label font-medium text-ink">
                          {module.title}
                          {isHidden && <span className="ml-2 td-text-caption text-ink-3">已隐藏</span>}
                        </div>
                        <div className="mt-0.5 td-text-caption text-ink-3">{module.description}</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!isHidden}
                        aria-label={`显示 ${module.title}`}
                        onClick={() => toggle(id)}
                        className={`h-7 w-12 shrink-0 rounded-pill p-0.5 transition ${
                          isHidden ? "bg-border-strong" : "bg-accent"
                        }`}
                      >
                        <span
                          className={`block h-6 w-6 rounded-pill bg-page transition ${
                            isHidden ? "translate-x-0" : "translate-x-5"
                          }`}
                        />
                      </button>
                    </div>
                  </SortableCategoryItem>
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      </section>
      <button
        type="button"
        aria-label="重置默认布局"
        onClick={reset}
        className="min-h-11 w-full rounded-pill border border-border bg-surface td-text-label text-ink-2"
      >
        重置默认布局
      </button>
    </SettingsDetailPage>
  );
}