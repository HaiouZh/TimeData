import { ArrowCounterClockwise, CaretDown, CaretUp, DotsThree, SidebarSimple } from "@phosphor-icons/react";
import { Icon } from "../../components/Icon.js";
import { Switch } from "../../components/ui/Switch.js";
import {
  DESKTOP_NAV_DEFAULT_ITEMS,
  findMainNavItem,
  type DesktopNavItemConfig,
} from "../../lib/navigation/navRegistry.js";
import { setDesktopSidebarConfig, useDesktopSidebarConfig } from "../../lib/settings/desktopSidebarSetting.js";
import { CONFIGURABLE_TABS, setVisibleTabs, useVisibleTabs, type ConfigurableTab } from "../../lib/settings/navVisibleTabsSetting.js";
import SettingsDetailPage from "./SettingsDetailPage.tsx";

function labelFor(to: string): string {
  return findMainNavItem(to)?.label ?? to;
}

export function SettingsNavPage() {
  const visibleTabs = useVisibleTabs();
  const desktopItems = useDesktopSidebarConfig();
  const visibleSet = new Set(visibleTabs);

  function toggle(tab: ConfigurableTab) {
    const next = new Set(visibleTabs);
    if (next.has(tab)) next.delete(tab);
    else next.add(tab);
    void setVisibleTabs(CONFIGURABLE_TABS.filter((item) => next.has(item)));
  }

  function persistDesktop(next: DesktopNavItemConfig[]) {
    void setDesktopSidebarConfig(next);
  }

  function moveDesktopItem(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= desktopItems.length) return;
    const next = [...desktopItems];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    persistDesktop(next);
  }

  function setDesktopPlacement(to: string, placement: "primary" | "more") {
    persistDesktop(desktopItems.map((item) => (item.to === to ? { ...item, placement } : item)));
  }

  function restoreDesktopDefaults() {
    persistDesktop(DESKTOP_NAV_DEFAULT_ITEMS);
  }

  return (
    <SettingsDetailPage title="导航">
      <section className="space-y-2">
        <div>
          <h3 className="text-base font-semibold text-ink">移动底栏</h3>
          <p className="mt-1 text-sm text-ink-3">控制窄屏与 APK 底部纯图标导航显示哪些入口。</p>
        </div>
        {CONFIGURABLE_TABS.map((tab) => {
          const navItem = findMainNavItem(tab);
          return (
            <label
              key={tab}
              className="flex min-h-12 items-center justify-between rounded-row border border-border bg-surface px-4 text-sm text-ink"
            >
              <span className="inline-flex items-center gap-2">
                {navItem && <Icon icon={navItem.icon} size={18} weight="regular" />}
                {labelFor(tab)}
              </span>
              <Switch ariaLabel={labelFor(tab)} checked={visibleSet.has(tab)} onChange={() => toggle(tab)} />
            </label>
          );
        })}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">桌面侧栏</h3>
            <p className="mt-1 text-sm text-ink-3">控制宽屏左侧纯图标导航的顺序和更多收纳。</p>
          </div>
          <button
            type="button"
            aria-label="恢复桌面侧栏默认"
            onClick={restoreDesktopDefaults}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-ctl border border-border px-3 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            <Icon icon={ArrowCounterClockwise} size={16} weight="regular" />
            恢复默认
          </button>
        </div>
        {desktopItems.map((item, index) => {
          const navItem = findMainNavItem(item.to);
          if (!navItem) return null;
          return (
            <div
              key={item.to}
              className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-row border border-border bg-surface px-4 text-sm text-ink"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <Icon icon={navItem.icon} size={18} weight="regular" />
                <span>{navItem.label}</span>
                <span className="inline-flex items-center gap-1 text-ink-3">
                  <Icon icon={item.placement === "more" ? DotsThree : SidebarSimple} size={15} weight="regular" />
                  {item.placement === "more" ? "更多" : "侧栏"}
                </span>
              </span>
              <span className="inline-flex gap-1">
                <button
                  type="button"
                  aria-label={`上移 ${navItem.label}`}
                  disabled={index === 0}
                  onClick={() => moveDesktopItem(index, -1)}
                  className="flex h-8 w-8 items-center justify-center rounded-ctl border border-border text-ink-2 hover:bg-surface-hover hover:text-ink disabled:opacity-40"
                >
                  <Icon icon={CaretUp} size={16} weight="regular" />
                </button>
                <button
                  type="button"
                  aria-label={`下移 ${navItem.label}`}
                  disabled={index === desktopItems.length - 1}
                  onClick={() => moveDesktopItem(index, 1)}
                  className="flex h-8 w-8 items-center justify-center rounded-ctl border border-border text-ink-2 hover:bg-surface-hover hover:text-ink disabled:opacity-40"
                >
                  <Icon icon={CaretDown} size={16} weight="regular" />
                </button>
              </span>
              <button
                type="button"
                aria-label={item.placement === "more" ? `移出更多 ${navItem.label}` : `收进更多 ${navItem.label}`}
                onClick={() => setDesktopPlacement(item.to, item.placement === "more" ? "primary" : "more")}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-ctl border border-border px-2 text-ink-2 hover:bg-surface-hover hover:text-ink"
              >
                <Icon icon={item.placement === "more" ? SidebarSimple : DotsThree} size={15} weight="regular" />
                {item.placement === "more" ? "放回侧栏" : "收进更多"}
              </button>
            </div>
          );
        })}
      </section>
    </SettingsDetailPage>
  );
}
