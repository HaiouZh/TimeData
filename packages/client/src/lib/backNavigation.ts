export type AndroidBackAction =
  | { type: "navigate"; to: string; replace?: boolean }
  | { type: "back"; fallbackTo: string }
  | { type: "exit" };

type Navigate = {
  (delta: number): void;
  (to: string, options?: { replace?: boolean }): void;
};
type ExitApp = () => void;

/**
 * 层级子页 → 返回落点。**不在表内即非子页**（tab 主页、首页、开发页），返回 null。
 * 两个消费方：安卓返回键（下面的 resolveAndroidBackAction 兜住非子页）、
 * iOS 边缘手势（只认这张表，非子页一律不响应——iPhone 的 tab 之间从不用手势切）。
 */
export function resolveBackTarget(pathname: string, _search = ""): AndroidBackAction | null {
  if (
    pathname === "/settings/data" ||
    pathname === "/settings/server" ||
    pathname === "/settings/categories" ||
    pathname === "/settings/more" ||
    pathname === "/settings/nav" ||
    pathname === "/settings/tracks" ||
    pathname === "/settings/insights" ||
    pathname === "/settings/stats-layout" ||
    pathname === "/settings/admin-insights" ||
    pathname === "/settings/todo-gravity" ||
    pathname === "/settings/diary" ||
    pathname === "/settings/todo-stats-layout"
  ) {
    return { type: "navigate", to: "/settings", replace: true };
  }

  if (/^\/settings\/categories\/[^/]+$/.test(pathname)) {
    return { type: "navigate", to: "/settings/categories", replace: true };
  }

  if (/^\/tracks\/[^/]+$/.test(pathname)) return { type: "navigate", to: "/tracks", replace: true };
  if (/^\/goals\/[^/]+$/.test(pathname)) return { type: "navigate", to: "/goals", replace: true };

  // 统计子页：改前落兜底回时间轴，属既有缺陷。
  if (pathname === "/stats/time" || pathname === "/stats/todo") {
    return { type: "navigate", to: "/stats", replace: true };
  }

  // 日记回顾：同上。
  if (pathname === "/diary/review") return { type: "navigate", to: "/diary", replace: true };

  if (pathname === "/entries/new" || /^\/entries\/[^/]+\/edit$/.test(pathname)) {
    return { type: "back", fallbackTo: "/" };
  }

  // 日记页：优先退回来处（通常是速记页），无历史时兜底回速记页。
  // 不能落兜底的 navigate("/", replace)——那会连历史都不留，未保存内容的守卫也就没机会拦。
  if (pathname === "/diary") return { type: "back", fallbackTo: "/quick-notes" };

  // 搜索页：优先退回来处（通常是时间轴），并让 URL 里的筛选状态随历史恢复。
  // 用 back 而非 navigate："时间轴 → 搜索 → 记录编辑 → 返回" 才能正确落回搜索页。
  if (pathname === "/search") return { type: "back", fallbackTo: "/" };

  return null;
}

/** 这条路由是不是「钻进去的页面」。iOS 边缘手势的生效判据之一。 */
export function hasParentRoute(pathname: string): boolean {
  return resolveBackTarget(pathname) !== null;
}

export function resolveAndroidBackAction(pathname: string, search = ""): AndroidBackAction {
  const target = resolveBackTarget(pathname, search);
  if (target) return target;

  // 以下是安卓返回键专属语义，iOS 手势不走：非子页也要有个去处。
  if (pathname === "/") {
    if (new URLSearchParams(search).has("date")) return { type: "back", fallbackTo: "/" };
    return { type: "exit" };
  }
  return { type: "navigate", to: "/", replace: true };
}

export function executeAndroidBackAction(
  action: AndroidBackAction,
  locationKey: string,
  navigate: Navigate,
  exitApp: ExitApp,
): void {
  if (action.type === "exit") {
    exitApp();
    return;
  }

  if (action.type === "back") {
    if (locationKey !== "default") {
      navigate(-1);
    } else {
      navigate(action.fallbackTo, { replace: true });
    }
    return;
  }

  navigate(action.to, { replace: action.replace });
}
