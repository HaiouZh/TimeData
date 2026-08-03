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
 * 地址归一化，只用于**匹配**（返回的落点始终是表里写死的规范地址）。
 *
 * react-router 的路由匹配默认**大小写不敏感、且容忍尾斜杠**，这张表必须跟它对齐：
 * 不对齐的后果是深链 / 外部链接进 `/settings/data/` 或 `/Settings/data` 时，页面照常渲染，
 * 这里却判它不是子页——iOS 边缘手势整页失效，安卓返回键从设置二级页直接跳回时间轴。
 */
function normalizePathname(pathname: string): string {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (trimmed === "" ? "/" : trimmed).toLowerCase();
}

/**
 * 层级子页 → 返回落点。**不在表内即非子页**（tab 主页、首页、开发页），返回 null。
 * 两个消费方：安卓返回键（下面的 resolveAndroidBackAction 兜住非子页）、
 * iOS 边缘手势（只认这张表，非子页一律不响应——iPhone 的 tab 之间从不用手势切）。
 *
 * 刷 query 不影响落点，故不收 search；首页 `?date=` 那条唯一看 query 的语义在下面的安卓专属分支里处理。
 */
export function resolveBackTarget(pathname: string): AndroidBackAction | null {
  const path = normalizePathname(pathname);
  if (
    path === "/settings/data" ||
    path === "/settings/server" ||
    path === "/settings/categories" ||
    path === "/settings/more" ||
    path === "/settings/nav" ||
    path === "/settings/tracks" ||
    path === "/settings/insights" ||
    path === "/settings/stats-layout" ||
    path === "/settings/admin-insights" ||
    path === "/settings/todo-gravity" ||
    path === "/settings/diary" ||
    path === "/settings/todo-stats-layout"
  ) {
    return { type: "navigate", to: "/settings", replace: true };
  }

  if (/^\/settings\/categories\/[^/]+$/.test(path)) {
    return { type: "navigate", to: "/settings/categories", replace: true };
  }

  if (/^\/tracks\/[^/]+$/.test(path)) return { type: "navigate", to: "/tracks", replace: true };
  if (/^\/goals\/[^/]+$/.test(path)) return { type: "navigate", to: "/goals", replace: true };

  // 统计子页：改前落兜底回时间轴，属既有缺陷。
  if (path === "/stats/time" || path === "/stats/todo") {
    return { type: "navigate", to: "/stats", replace: true };
  }

  // 日记回顾：同上。
  if (path === "/diary/review") return { type: "navigate", to: "/diary", replace: true };

  if (path === "/entries/new" || /^\/entries\/[^/]+\/edit$/.test(path)) {
    return { type: "back", fallbackTo: "/" };
  }

  // 日记页：优先退回来处（通常是速记页），无历史时兜底回速记页。
  // 不能落兜底的 navigate("/", replace)——那会连历史都不留，未保存内容的守卫也就没机会拦。
  if (path === "/diary") return { type: "back", fallbackTo: "/quick-notes" };

  // 搜索页：优先退回来处（通常是时间轴），并让 URL 里的筛选状态随历史恢复。
  // 用 back 而非 navigate："时间轴 → 搜索 → 记录编辑 → 返回" 才能正确落回搜索页。
  if (path === "/search") return { type: "back", fallbackTo: "/" };

  return null;
}

/** 这条路由是不是「钻进去的页面」。iOS 边缘手势的生效判据之一。 */
export function hasParentRoute(pathname: string): boolean {
  return resolveBackTarget(pathname) !== null;
}

export function resolveAndroidBackAction(pathname: string, search = ""): AndroidBackAction {
  const target = resolveBackTarget(pathname);
  if (target) return target;

  // 以下是安卓返回键专属语义，iOS 手势不走：非子页也要有个去处。
  if (normalizePathname(pathname) === "/") {
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
