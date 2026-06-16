import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const viteConfigSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("font loading setup", () => {
  it("imports webfont CSS before app styles", () => {
    // 只引 GB 屏显字族（lxgwwenkaigbscreen.css），不引 style.css——后者会拉入 R 变体与非 GB 重复字族，
    // 把 4 套字族（~18.8MB）全打进 APK。单 import 后只剩这一套（~4.7MB）。
    const lxgwImport = mainSource.indexOf('import "lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css";');
    const tinosRegularImport = mainSource.indexOf('import "@fontsource/tinos/400.css";');
    const tinosItalicImport = mainSource.indexOf('import "@fontsource/tinos/400-italic.css";');
    const tinosBoldImport = mainSource.indexOf('import "@fontsource/tinos/700.css";');
    const appStyleImport = mainSource.indexOf('import "./index.css";');

    expect(lxgwImport).toBeGreaterThanOrEqual(0);
    expect(tinosRegularImport).toBeGreaterThan(lxgwImport);
    expect(tinosItalicImport).toBeGreaterThan(tinosRegularImport);
    expect(tinosBoldImport).toBeGreaterThan(tinosItalicImport);
    expect(appStyleImport).toBeGreaterThan(tinosBoldImport);
  });

  it("keeps PWA font files in a CacheFirst runtime cache", () => {
    expect(viteConfigSource).toContain('request.destination === "font"');
    expect(viteConfigSource).toContain('handler: "CacheFirst"');
    expect(viteConfigSource).toContain('cacheName: "timedata-fonts"');
    expect(viteConfigSource).toContain("maxEntries: 400");
    expect(viteConfigSource).toContain("maxAgeSeconds: 60 * 60 * 24 * 365");
    expect(viteConfigSource).toContain("cacheableResponse: { statuses: [0, 200] }");
  });
});
