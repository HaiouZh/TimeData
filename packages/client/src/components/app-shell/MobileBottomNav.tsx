import { NavLink } from "react-router";
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
      className={`flex shrink-0 overflow-hidden bg-surface-elevated transition-[height,padding-bottom] duration-200 ${
        hidden ? "" : "border-t border-border"
      }`}
      // nav 背景必须铺到屏幕最底（home 横条区露出底色就是 bug），故总高 = 内容高 + 底部安全区；
      // 隐藏时高度与内边距必须**同时**归零——border-box 下只归零 height 会被 padding 撑成 inset 高的一条空带。
      // 内边距用 calc 包裹而非裸 env()：与浮层批次同一写法，jsdom 的 CSSOM 也能保留该值供测试断言。
      // env(safe-area-inset-bottom) 未定义的环境（Firefox 桌面 / 旧 WebView）里两个 calc 都失效：
      // height 落回 auto（内容高 ≈49px）、paddingBottom 落回 0——恰是批次前的桌面行为，无需兜底类。
      // 安全区经 var(--safe-bottom) 流入（:root 默认 env()，Android 壳清零），见 index.css。
      style={{
        height: hidden ? 0 : `calc(${BOTTOM_NAV_HEIGHT_PX}px + var(--safe-bottom))`,
        paddingBottom: hidden ? 0 : "calc(0px + var(--safe-bottom))",
      }}
    >
      {items.map((item) => (
        <MobileIconLink key={item.to} item={item} badge={item.to === "/tracks" ? attentionCount : 0} />
      ))}
    </nav>
  );
}
