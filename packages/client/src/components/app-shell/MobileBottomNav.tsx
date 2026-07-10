import { NavLink } from "react-router-dom";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../../contexts/BottomNavContext.js";
import { useTrackAttentionBadge } from "../../contexts/TrackAttentionContext.js";
import { findMainNavItem, type MainNavItem, type MainNavRoute } from "../../lib/navigation/navRegistry.js";
import { useVisibleTabs } from "../../lib/settings/navVisibleTabsSetting.js";
import { Icon } from "../Icon.js";
import { NavBadge } from "./NavBadge.js";

function MobileIconLink({ item, badge = 0 }: { item: MainNavItem; badge?: number }) {
  return (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === "/"}
      aria-label={item.ariaLabel}
      title={item.label}
      className={({ isActive }) =>
        `flex flex-1 items-center justify-center rounded-row transition-colors ${
          isActive
            ? "bg-accent-soft text-accent ring-1 ring-inset ring-accent/30"
            : "text-ink-3 hover:bg-surface-hover hover:text-ink-2"
        }`
      }
    >
      <span className="relative">
        <Icon icon={item.icon} size={23} weight="regular" />
        <NavBadge count={badge} />
      </span>
    </NavLink>
  );
}

export function MobileBottomNav() {
  const { hidden } = useBottomNav();
  const attentionCount = useTrackAttentionBadge();
  const visibleTabs = useVisibleTabs();
  const routes = [...visibleTabs, "/settings"] as MainNavRoute[];
  const items = routes.map((route) => findMainNavItem(route)).filter((item) => item !== undefined);

  return (
    <nav
      aria-label="主导航"
      className={`flex shrink-0 overflow-hidden bg-surface-elevated transition-[height] duration-200 ${
        hidden ? "" : "border-t border-border"
      }`}
      style={{ height: hidden ? 0 : BOTTOM_NAV_HEIGHT_PX }}
    >
      {items.map((item) => (
        <MobileIconLink key={item.to} item={item} badge={item.to === "/tracks" ? attentionCount : 0} />
      ))}
    </nav>
  );
}
