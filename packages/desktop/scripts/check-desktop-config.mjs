import { readdirSync, readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));

// frontendDist 指错就会打包出一个空壳或旧产物，且 tauri build 不一定报错——棘轮住。
if (config.build?.frontendDist !== "../../client/dist") {
  throw new Error(
    `[desktop-config] build.frontendDist 必须是 ../../client/dist（client 的 mode=mobile 产物），当前：${config.build?.frontendDist}`,
  );
}

// 必须吃 mobile 模式产物：普通 build 会注册 service worker，把网页那套自毁重载链
// 带进常驻壳（见 metaspec §2.7）。
for (const key of ["beforeBuildCommand", "beforeDevCommand"]) {
  if (!/build:mobile/.test(config.build?.[key] ?? "")) {
    throw new Error(`[desktop-config] build.${key} 必须调用 client 的 build:mobile，当前：${config.build?.[key]}`);
  }
}

if (config.identifier !== "icu.yanzhou.timedata") {
  throw new Error(`[desktop-config] identifier 必须是 icu.yanzhou.timedata，当前：${config.identifier}`);
}

const targets = config.bundle?.targets;
if (!Array.isArray(targets) || targets.length !== 1 || targets[0] !== "nsis") {
  throw new Error(`[desktop-config] bundle.targets 必须恰好是 ["nsis"]，当前：${JSON.stringify(targets)}`);
}

// 手动启动必须看得见窗口——否则首次安装后用户找不到入口去填服务器地址。
// 开机自启的隐藏走 --hidden 参数，不靠这个配置。
const mainWindow = config.app?.windows?.[0];
if (mainWindow?.visible !== true) {
  throw new Error("[desktop-config] 主窗口 visible 必须为 true（开机自启的隐藏走 --hidden 参数，不改这里）");
}

// ---- 跨语言契约：热键事件名两端必须逐字相同 ----
// Rust `app.emit(name, …)` 与前端 `listen(name, …)` 之间没有共享类型，typecheck 管不到
// 字符串字面量。打错一个字母：注册成功、按键有反应、Rust 侧照常 emit，前端永远收不到，
// 整条打点链路静默失效且没有任何报错。两边都比对同一个字面量，改一侧就红。
const HOTKEY_EVENT_NAME = "desktop-hotkey";
const EVENT_NAME_SITES = [
  ["packages/desktop/src-tauri/src/commands.rs", "../src-tauri/src/commands.rs"],
  ["packages/client/src/lib/desktop/api.ts", "../../client/src/lib/desktop/api.ts"],
];
for (const [label, relative] of EVENT_NAME_SITES) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  if (!source.includes(`"${HOTKEY_EVENT_NAME}"`)) {
    throw new Error(
      `[desktop-config] ${label} 里找不到热键事件名 "${HOTKEY_EVENT_NAME}"。` +
        `Rust emit 与前端 listen 用的是同一个字符串字面量，只改一侧会让打点静默失效——两侧要一起改，本闸也要跟着改。`,
    );
  }
}

// ---- 三端 bundle 隔离：@tauri-apps/api 只准动态 import ----
// Web / Android / iOS 三端吃的是同一份 client 产物。静态 import 会把 Tauri 运行时拉进
// 入口 chunk，在没有 __TAURI_INTERNALS__ 的环境里加载即报错；动态 import 则出独立 chunk，
// 只有 isDesktopShell() gate 内才会去取。这条约定破了没有任何现有门禁会红。
const CLIENT_SRC = new URL("../../client/src/", import.meta.url);
const STATIC_TAURI_IMPORT = /\bfrom\s*["']@tauri-apps\/api|^\s*import\s*["']@tauri-apps\/api/m;

function collectSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) files.push(...collectSourceFiles(child));
    else if (/\.tsx?$/.test(entry.name)) files.push(child);
  }
  return files;
}

for (const file of collectSourceFiles(CLIENT_SRC)) {
  if (STATIC_TAURI_IMPORT.test(readFileSync(file, "utf8"))) {
    const shown = decodeURIComponent(file.pathname).slice(decodeURIComponent(CLIENT_SRC.pathname).length);
    throw new Error(
      `[desktop-config] packages/client/src/${shown} 静态 import 了 @tauri-apps/api。` +
        `只准写 await import("@tauri-apps/api/…") 且要在 isDesktopShell() gate 之内，否则三端 bundle 会把 Tauri 运行时打进入口 chunk。` +
        `需要类型就在 lib/desktop/api.ts 里自己声明（现有 DTO 就是这么写的）。`,
    );
  }
}

console.log("[desktop-config] snapshot checks passed");
