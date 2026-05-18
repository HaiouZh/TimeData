import { URL, fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type PluginOption, defineConfig } from "vite";
import { VitePWA, type VitePWAOptions } from "vite-plugin-pwa";
import { readAndroidVersionCode } from "./viteVersion";

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
  const plugins: PluginOption[] = [react(), tailwindcss()];

  if (!isMobile) {
    plugins.push(VitePWA(createPwaOptions()));
  }

  return {
    base: isMobile ? "./" : "/",
    define: {
      __TIMEDATA_ANDROID_VERSION_CODE__: JSON.stringify(readAndroidVersionCode()),
    },
    plugins,
    resolve: {
      alias: isMobile
        ? {
            "virtual:pwa-register/react": fileURLToPath(new URL("./src/appUpdate.mobile.ts", import.meta.url)),
          }
        : {},
    },
    server: {
      proxy: {
        "/api": "http://localhost:3000",
      },
    },
  };
});
