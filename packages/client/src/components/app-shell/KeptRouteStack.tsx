import { Suspense, useState } from "react";
import { type Location, useLocation } from "react-router";
import { AppRoutes } from "./AppRoutes.tsx";
import { MobileBottomNav } from "./MobileBottomNav.tsx";

const MAX_LAYERS = 2;

function layoutHidesBottomNav(pathname: string): boolean {
  return (
    pathname.startsWith("/entries/") ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/goals/") ||
    pathname.startsWith("/tracks/")
  );
}

/** 纯函数：新 location 到来时栈怎么变。导出供测试单独喂数据。 */
export function nextStack(prev: Location[], location: Location): Location[] {
  const last = prev[prev.length - 1];
  if (last?.key === location.key) return prev;

  // 回到栈里已有的那条历史（navigate(-1)）：截断到它为止，复用其组件树。
  const existing = prev.findIndex((l) => l.key === location.key);
  if (existing >= 0) return prev.slice(0, existing + 1);

  const appended = [...prev, location];
  // 超限只从**头部**丢：剩余层的相对顺序不变，React 只做 removeChild、不移动已挂载节点。
  // 一旦让 React 移动某层，DOM 节点被搬走，其滚动容器 scrollTop 就可能被清掉——
  // 与误用 display:none 同一症状族。见 design §2.5.1-1。
  return appended.length > MAX_LAYERS ? appended.slice(appended.length - MAX_LAYERS) : appended;
}

interface KeptRouteStackProps {
  isWideScreen?: boolean;
  onMainScroll?: (event: React.UIEvent<HTMLElement>) => void;
}

/**
 * iOS 专用：钻进子页时上一页**不卸载**，留在栈里用 visibility 隐藏。
 * 边缘返回手势因此能露出活的上一页，返回后滚动位置与组件 state 天然还在。
 *
 * 三条不可违反的纪律（写错不报错、只在真机上表现为「位置偶尔丢」）：
 * 1. 栈只 append、只从头部移除，永不 reorder（见 nextStack）。
 * 2. 两层恒 absolute inset-0，切换只改 visibility——**绝不能用 display:none**，
 *    无 layout box 会让滚动容器 scrollTop 清零，整套机制的收益归零。
 * 3. 每层各自一个 Suspense：共用边界会让子页懒加载时整个栈一起挂起，
 *    保留层跟着消失、手势没有底层可露，还闪一帧白。
 */
export function KeptRouteStack({ isWideScreen, onMainScroll }: KeptRouteStackProps) {
  const location = useLocation();
  const [stack, setStack] = useState<Location[]>(() => [location]);

  // 渲染期同步纠正（React 官方的 "adjusting state during render" 模式）：
  // 放进 useEffect 会先渲染旧栈再补一帧，进子页时会闪一下旧内容。
  const computed = nextStack(stack, location);
  if (computed !== stack) setStack(computed);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      {computed.map((loc, index) => {
        const active = index === computed.length - 1;
        return (
          <div
            key={loc.key}
            data-kept-layer={active ? "active" : "kept"}
            className="absolute inset-0 flex flex-col"
            style={{ visibility: active ? "visible" : "hidden" }}
            aria-hidden={active ? undefined : "true"}
            inert={active ? undefined : true}
          >
            <main
              className="min-h-0 flex-1 overflow-y-auto overscroll-y-none"
              onScroll={active && !isWideScreen ? onMainScroll : undefined}
            >
              <Suspense fallback={null}>
                <AppRoutes location={loc} />
              </Suspense>
            </main>
            {/* 底栏在**层内**：返回手势中上一页的底栏跟着一起滑回来，才像 iOS 原生。
                代价是它的 NavLink 高亮读真实当前 location（在 <Routes location> 之外），
                手势期间保留层的高亮会短暂不准——已知取舍，见 design。 */}
            {!isWideScreen && !layoutHidesBottomNav(loc.pathname) && <MobileBottomNav />}
          </div>
        );
      })}
      {/* 手势期间由 EdgeSwipeBack 直接改 opacity；静止时完全透明且不吃事件。 */}
      <div
        data-kept-overlay
        className="pointer-events-none absolute inset-0 bg-backdrop"
        style={{ opacity: 0 }}
        aria-hidden="true"
      />
    </div>
  );
}
