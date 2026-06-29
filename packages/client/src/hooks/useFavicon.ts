import { useEffect } from "react";
import { faviconDataUriForPath } from "../lib/navigation/routeFavicon.js";

const FAVICON_ID = "route-favicon";

/**
 * 让浏览器标签/书签图标随当前路由变化为对应模块图标。
 * 与 useDocumentTitle 同理：书签抓取的是收藏那一刻的 <link rel="icon">，
 * 单页应用默认不更新，所以这里在每次路径变化时动态写入模块图标的 svg data-URI。
 * 浏览器对 svg favicon 优先级高于 index.html 里的 png，因此无需移除原有静态图标。
 */
export function useFavicon(pathname: string): void {
  useEffect(() => {
    const href = faviconDataUriForPath(pathname);
    if (!href) return;
    let link = document.getElementById(FAVICON_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = FAVICON_ID;
      link.rel = "icon";
      link.type = "image/svg+xml";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [pathname]);
}
