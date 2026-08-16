import { URL, fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type PluginOption, defineConfig } from "vite";
import { VitePWA, type VitePWAOptions } from "vite-plugin-pwa";
import { readAndroidVersionCode, readBuildId } from "./viteVersion";

export function createPwaOptions(): Partial<VitePWAOptions> {
  return {
    registerType: "autoUpdate",
    workbox: {
      globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
      runtimeCaching: [
        {
          urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
          handler: "NetworkOnly",
        },
        {
          urlPattern: ({ request }) => request.destination === "font",
          handler: "CacheFirst",
          options: {
            cacheName: "timedata-fonts",
            expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
    manifest: {
      name: "TimeData 时间记录",
      short_name: "TimeData",
      description: "本地优先的时间记录 PWA",
      lang: "zh-CN",
      theme_color: "#0f172a",
      background_color: "#0f172a",
      display: "standalone",
      orientation: "portrait",
      start_url: "/",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      ],
    },
  };
}

export default defineConfig(({ mode }) => {
  const isMobile = mode === "mobile";
  const buildId = readBuildId();
  const plugins: PluginOption[] = [react(), tailwindcss()];

  if (!isMobile) {
    plugins.push(VitePWA(createPwaOptions()));
    plugins.push({
      name: "timedata-version-json",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ buildId }),
        });
      },
    });
  }

  return {
    // 恒绝对：三个壳（Capacitor iOS / Android、Tauri）都从各自的根提供这份产物，而路由是
    // 多段路径（底栏「统计」= /stats/time）。相对 base 下，原地重载时 ./assets/x.js 会解析成
    // /stats/assets/x.js —— Capacitor iOS 的 Router 只对无扩展名路径回退 index.html，带
    // 扩展名的直接按字面找文件 → JS/CSS 双双 404 → 纯白屏。现场与判据见 docs/evergreen/ios.md §6。
    base: "/",
    define: {
      __TIMEDATA_ANDROID_VERSION_CODE__: JSON.stringify(readAndroidVersionCode()),
      __TIMEDATA_BUILD_ID__: JSON.stringify(buildId),
    },
    plugins,
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                // 框架层：极少升级，独立 chunk 让业务改动不刷缓存
                name: "vendor-react",
                test: /node_modules[\\/](?:react|react-dom|scheduler|react-router|react-router-dom)[\\/]/,
              },
              {
                // 数据层：dexie/zod 全局必需
                name: "vendor-data",
                test: /node_modules[\\/](?:dexie|dexie-react-hooks|zod)[\\/]/,
              },
            ],
          },
        },
      },
    },
    resolve: {
      alias: isMobile
        ? {
            "virtual:pwa-register/react": fileURLToPath(new URL("./src/appUpdate.mobile.ts", import.meta.url)),
          }
        : {},
    },
    server: {
      port: 5174,
      proxy: {
        "/api": "http://localhost:3000",
      },
    },
  };
});
