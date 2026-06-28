import { useEffect } from "react";
import { documentTitleForPath } from "../lib/navigation/documentTitle.js";

/**
 * 让浏览器标签/书签标题随当前路由变化。
 * 书签抓取的标题就是收藏那一刻的 document.title，单页应用默认不更新，
 * 所以这里在每次路径变化时按分区写入「分区名 · TimeData」。
 */
export function useDocumentTitle(pathname: string): void {
  useEffect(() => {
    document.title = documentTitleForPath(pathname);
  }, [pathname]);
}
