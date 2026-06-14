export type AndroidBackAction =
  | { type: "navigate"; to: string; replace?: boolean }
  | { type: "back"; fallbackTo: string }
  | { type: "exit" };

type Navigate = {
  (delta: number): void;
  (to: string, options?: { replace?: boolean }): void;
};
type ExitApp = () => void;

export function resolveAndroidBackAction(pathname: string): AndroidBackAction {
  if (pathname === "/") return { type: "exit" };

  if (
    pathname === "/settings/data" ||
    pathname === "/settings/server" ||
    pathname === "/settings/categories" ||
    pathname === "/settings/admin-insights"
  ) {
    return { type: "navigate", to: "/settings", replace: true };
  }

  if (pathname === "/settings/data/backup-history") {
    return { type: "navigate", to: "/settings/data", replace: true };
  }

  if (/^\/settings\/categories\/[^/]+$/.test(pathname)) {
    return { type: "navigate", to: "/settings/categories", replace: true };
  }

  if (pathname === "/entries/new" || /^\/entries\/[^/]+\/edit$/.test(pathname)) {
    return { type: "back", fallbackTo: "/" };
  }

  if (
    pathname === "/quick-notes" ||
    pathname === "/stats" ||
    pathname === "/stats/time" ||
    pathname === "/stats/health" ||
    pathname === "/categories" ||
    pathname === "/settings"
  ) {
    return { type: "navigate", to: "/", replace: true };
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
