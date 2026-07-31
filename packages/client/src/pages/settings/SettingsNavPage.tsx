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
import { ArrowCounterClockwise, DotsThree, SidebarSimple } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import SortableCategoryItem from "../../components/SortableCategoryItem.tsx";
import { Switch } from "../../components/ui/Switch.js";
import { reorderById } from "../../lib/navOrder.js";
import {
  DESKTOP_NAV_DEFAULT_ITEMS,
  findMainNavItem,
} from "../../lib/navigation/navRegistry.js";
import { setDesktopSidebarConfig, useDesktopSidebarConfig } from "../../lib/settings/desktopSidebarSetting.js";
import { setTabOrder, useTabOrder, type ConfigurableTab } from "../../lib/settings/navVisibleTabsSetting.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

function labelFor(to: string): string {
  return findMainNavItem(to)?.label ?? to;
}

export function SettingsNavPage() {
  const tabOrder = useTabOrder();
  const desktopItems = useDesktopSidebarConfig();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function toggle(tab: ConfigurableTab) {
    void setTabOrder(tabOrder.map((item) => (item.to === tab ? { ...item, hidden: !item.hidden } : item)));
  }

  function handleMobileDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void setTabOrder(reorderById(tabOrder, String(active.id), String(over.id), (item) => item.to));
  }

  function handleDesktopDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void setDesktopSidebarConfig(reorderById(desktopItems, String(active.id), String(over.id), (item) => item.to));
  }

  function setDesktopPlacement(to: string, placement: "primary" | "more") {
    void setDesktopSidebarConfig(
      desktopItems.map((item) => (item.to === to ? { ...item, placement } : item)),
    );
  }

  function restoreDesktopDefaults() {
    void setDesktopSidebarConfig(DESKTOP_NAV_DEFAULT_ITEMS);
  }

  return (
    <SettingsDetailPage title="导航">
      <section className="space-y-2">
        <div>
          <h3 className="td-text-body font-semibold text-ink">手机底栏</h3>
          <p className="td-text-label mt-1 text-ink-3">
            开启后显示在手机底栏；关闭后显示在“设置 &gt; 更多功能”。拖动调整顺序。
          </p>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleMobileDragEnd}>
          <SortableContext items={tabOrder.map((item) => item.to)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {tabOrder.map((item) => {
                const tab = item.to;
                const navItem = findMainNavItem(tab);
                return (
                  <SortableCategoryItem
                    key={tab}
                    id={tab}
                    dragLabel={`拖动 ${labelFor(tab)}`}
                    className={`flex items-stretch rounded-row border border-border bg-surface td-text-label text-ink ${
                      item.hidden ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex w-full min-w-0 items-center justify-between gap-2 pr-2">
                      <span className="inline-flex items-center gap-2">
                        {navItem && <Icon icon={navItem.icon} size={18} weight="regular" />}
                        {labelFor(tab)}
                        {item.hidden && <span className="td-text-caption text-ink-3">已隐藏</span>}
                      </span>
                      <Switch
                        ariaLabel={`显示 ${labelFor(tab)}`}
                        checked={!item.hidden}
                        onChange={() => toggle(tab)}
                      />
                    </div>
                  </SortableCategoryItem>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="td-text-body font-semibold text-ink">桌面侧栏</h3>
            <p className="mt-1 td-text-body text-ink-3">
              控制宽屏左侧纯图标导航的顺序和更多收纳。拖动调整顺序。
            </p>
          </div>
          <button
            type="button"
            aria-label="恢复桌面侧栏默认"
            onClick={restoreDesktopDefaults}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-ctl border border-border px-3 td-text-label text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            <Icon icon={ArrowCounterClockwise} size={16} weight="regular" />
            恢复默认
          </button>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDesktopDragEnd}>
          <SortableContext items={desktopItems.map((item) => item.to)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {desktopItems.map((item) => {
                const navItem = findMainNavItem(item.to);
                if (!navItem) return null;
                return (
                  <SortableCategoryItem
                    key={item.to}
                    id={item.to}
                    dragLabel={`拖动 ${navItem.label}`}
                    className="flex items-stretch rounded-row border border-border bg-surface td-text-label text-ink"
                  >
                    <div className="flex w-full min-w-0 items-center gap-2 pr-2">
                      <span className="flex min-w-0 flex-1 items-center gap-2 px-2">
                        <Icon icon={navItem.icon} size={18} weight="regular" />
                        <span>{navItem.label}</span>
                        <span className="inline-flex items-center gap-1 text-ink-3">
                          <Icon
                            icon={item.placement === "more" ? DotsThree : SidebarSimple}
                            size={15}
                            weight="regular"
                          />
                          {item.placement === "more" ? "更多" : "侧栏"}
                        </span>
                      </span>
                      <button
                        type="button"
                        aria-label={
                          item.placement === "more" ? `移出更多 ${navItem.label}` : `收进更多 ${navItem.label}`
                        }
                        onClick={() => setDesktopPlacement(item.to, item.placement === "more" ? "primary" : "more")}
                        className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-ctl border border-border px-2 text-ink-2 hover:bg-surface-hover hover:text-ink"
                      >
                        <Icon
                          icon={item.placement === "more" ? SidebarSimple : DotsThree}
                          size={15}
                          weight="regular"
                        />
                        {item.placement === "more" ? "放回侧栏" : "收进更多"}
                      </button>
                    </div>
                  </SortableCategoryItem>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </section>
    </SettingsDetailPage>
  );
}