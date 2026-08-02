import { readFileSync } from "node:fs";

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

console.log("[desktop-config] snapshot checks passed");
