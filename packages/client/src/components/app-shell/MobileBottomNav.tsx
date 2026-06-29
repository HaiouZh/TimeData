import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../../contexts/BottomNavContext.js";
import { MAIN_NAV_ITEMS, MORE_NAV_ITEM, findMainNavItem, type MainNavItem, type MainNavRoute } from "../../lib/navigation/navRegistry.js";
import { useVisibleTabs } from "../../lib/settings/navVisibleTabsSetting.js";
import { Icon } from "../Icon.js";

function MobileIconLink({ item, onClick }: { item: MainNavItem; onClick?: () => void }) {
  return (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === "/"}
      aria-label={item.ariaLabel}
      title={item.label}
      onClick={onClick}
      className={({ isActive }) =>
        `flex flex-1 items-center justify-center rounded-row transition-colors ${
          isActive
            ? "bg-accent-soft text-accent ring-1 ring-inset ring-accent/30"
            : "text-ink-3 hover:bg-surface-hover hover:text-ink-2"
        }`
      }
    >
      <Icon icon={item.icon} size={23} weight="regular" />
    </NavLink>
  );
}

export function MobileBottomNav() {
  const [open, setOpen] = useState(false);
  const { hidden } = useBottomNav();
  const visibleTabs = useVisibleTabs();
  const routes = [...visibleTabs, "/settings"] as MainNavRoute[];
  const items = routes.map((route) => findMainNavItem(route)).filter((item) => item !== undefined);
  const hiddenItems = useMemo(() => {
    const visibleRoutes = new Set(routes);
    return MAIN_NAV_ITEMS.filter((item) => !visibleRoutes.has(item.to));
  }, [routes]);
  const showMoreMenu = open && !hidden;

  useEffect(() => {
    if (hidden && open) setOpen(false);
  }, [hidden, open]);

  return (
    <nav
      aria-label="主导航"
      className={`flex shrink-0 overflow-hidden bg-surface-elevated transition-[height] duration-200 ${
        hidden ? "" : "border-t border-border"
      }`}
      style={{ height: hidden ? 0 : BOTTOM_NAV_HEIGHT_PX }}
    >
      {items.map((item) => (
        <MobileIconLink key={item.to} item={item} />
      ))}
      {hiddenItems.length > 0 && (
        <div className="relative flex flex-1 justify-center">
          <button
            type="button"
            aria-label={MORE_NAV_ITEM.ariaLabel}
            title={MORE_NAV_ITEM.label}
            aria-expanded={showMoreMenu}
            onClick={() => setOpen((value) => !value)}
            className="flex h-full w-full items-center justify-center text-ink-3 transition-colors hover:text-ink-2"
          >
            <Icon icon={MORE_NAV_ITEM.icon} size={23} weight="regular" />
          </button>
          {showMoreMenu && (
            <div className="fixed bottom-14 right-1 z-[var(--z-dropdown)] min-w-36 rounded-card border border-border bg-surface-elevated p-1 shadow-elev2">
              {hiddenItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-label={item.ariaLabel}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-row px-3 py-2 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
                >
                  <Icon icon={item.icon} size={18} weight="regular" />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
