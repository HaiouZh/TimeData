import { describe, expect, it } from "vitest";
import viteConfig from "./vite.config";

/**
 * 三个壳（Capacitor iOS / Android、Tauri）都从各自的根提供这份产物，而路由是多段路径——
 * 底栏「统计」就是 `/stats/time`。base 若为相对，index.html 里的 `./assets/x.js` 在
 * `/stats/time` 上会解析成 `/stats/assets/x.js`；Capacitor iOS 的 `Router.route(for:)`
 * 只对**无扩展名**的路径回退 index.html，带 `.js`/`.css` 的直接按字面找文件 → 双双 404
 * → React 从不挂载，而 index.css 没给 body 背景色，屏幕就是一张纯白页。
 *
 * 触发点是任何一次原地重载：SchedulerWatchdog 的死锁自救、ErrorBoundary 的「刷新」按钮。
 * 冷启动不暴露（壳总是从 `/` 起），故这条只在「长时间后台回来」这类现场才现形。
 */
const SHELL_DOCUMENT_URLS = [
  "capacitor://localhost/",
  "capacitor://localhost/todo",
  // 底栏 tab，用户眼里的一级主页面，URL 却有两段——线上白屏的现场就是它。
  "capacitor://localhost/stats/time",
  "capacitor://localhost/settings/data",
  "capacitor://localhost/tracks/t-123",
  "https://localhost/goals/g-42",
  "http://tauri.localhost/index.html?window=capture",
];

describe("壳产物的 base", () => {
  it("在任意深度的路由上重载，资源引用都解析到根部 assets", () => {
    const config = viteConfig({ command: "build", mode: "mobile" });
    // 缺省（undefined）等同于相对解析，与写死 "./" 一样会在深路由上跑偏，故不给兜底默认值。
    const base = config.base ?? "";

    for (const documentUrl of SHELL_DOCUMENT_URLS) {
      const resolved = new URL(`${base}assets/index-abc123.js`, documentUrl);
      expect(resolved.pathname, `文档 URL ${documentUrl}`).toBe("/assets/index-abc123.js");
    }
  });
});
