import { useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MORE_NAV_ITEM, findMainNavItem, primaryRouteForPath, type MainNavItem } from "../../lib/navigation/navRegistry.js";
import { useDesktopSidebarConfig } from "../../lib/settings/desktopSidebarSetting.js";
import { Icon } from "../Icon.js";

function NavIconLink({ item, activeRoute }: { item: MainNavItem; activeRoute: string }) {
  const active = item.to === activeRoute;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      aria-label={item.ariaLabel}
      title={item.label}
      className={`flex h-11 w-11 items-center justify-center rounded-row transition-colors ${
        active ? "bg-accent-soft text-accent" : "text-ink-3 hover:bg-surface-hover hover:text-ink"
      }`}
    >
      <Icon icon={item.icon} size={22} weight="regular" />
    </NavLink>
  );
}

export function DesktopSidebar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const activeRoute = primaryRouteForPath(location.pathname);
  const config = useDesktopSidebarConfig();

  const { primaryItems, moreItems } = useMemo(() => {
    const primaryItems: MainNavItem[] = [];
    const moreItems: MainNavItem[] = [];
    for (const item of config) {
      const navItem = findMainNavItem(item.to);
      if (!navItem) continue;
      if (item.placement === "more") moreItems.push(navItem);
      else primaryItems.push(navItem);
    }
    return { primaryItems, moreItems };
  }, [config]);

  return (
    <aside
      aria-label="桌面主导航"
      className="flex w-16 shrink-0 flex-col items-center border-r border-border bg-surface-elevated py-3 text-ink"
    >
      <div className="flex flex-1 flex-col items-center gap-2">
        {primaryItems.map((item) => (
          <NavIconLink key={item.to} item={item} activeRoute={activeRoute} />
        ))}
        {moreItems.length > 0 && (
          <div className="relative">
            <button
              type="button"
              aria-label={MORE_NAV_ITEM.ariaLabel}
              title={MORE_NAV_ITEM.label}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="flex h-11 w-11 items-center justify-center rounded-row text-ink-3 transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <Icon icon={MORE_NAV_ITEM.icon} size={22} weight="regular" />
            </button>
            {open && (
              <div className="absolute left-12 top-0 z-30 min-w-36 rounded-card border border-border bg-surface-elevated p-1 shadow-elev2">
                {moreItems.map((item) => (
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
      </div>
    </aside>
  );
}
