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

// updater 四项：配错时构建、测试、其余断言全绿，装机后表现为更新静默失效，
// 或（installMode 那条）丢掉「删数据复选框不渲染」这道锁。
if (config.bundle?.createUpdaterArtifacts !== true) {
  throw new Error(
    "[desktop-config] bundle.createUpdaterArtifacts 必须为 true，否则 bundler 不产 .sig，latest.json 的 signature 无处可取。",
  );
}

const updater = config.plugins?.updater;
if (typeof updater?.pubkey !== "string" || updater.pubkey.length === 0) {
  throw new Error("[desktop-config] plugins.updater.pubkey 不能为空——它是更新包验签的唯一依据。");
}

const EXPECTED_ENDPOINT =
  "https://github.com/HaiouZh/TimeData/releases/download/desktop-latest/latest.json";
if (!Array.isArray(updater.endpoints) || updater.endpoints.length !== 1 || updater.endpoints[0] !== EXPECTED_ENDPOINT) {
  throw new Error(
    `[desktop-config] plugins.updater.endpoints 必须恰好是 ["${EXPECTED_ENDPOINT}"]，当前：${JSON.stringify(updater.endpoints)}。` +
      "不可改用 releases/latest/download/——GitHub 的 latest 标记是 Android 包专属（windows job 刻意不碰），那条路会指向不含 Windows 包的 Release。",
  );
}

if (updater.windows?.installMode !== "passive") {
  throw new Error(
    `[desktop-config] plugins.updater.windows.installMode 必须显式为 passive，当前：${JSON.stringify(updater.windows?.installMode)}。` +
      "passive 让 NSIS 跳过卸载确认页（删数据复选框因此不渲染），是与 /UPDATE 参数并列的第二道锁——不能靠默认值兜着。",
  );
}

// 按 label 取窗口，**不按下标**——加了浮窗之后 windows[0] 可能是浮窗，
// 主窗口的 visible 断言会静默跑到错误的对象上。
const windows = config.app?.windows ?? [];
const byLabel = new Map(windows.map((w) => [w.label, w]));

const mainWindow = byLabel.get("main");
if (!mainWindow) {
  throw new Error('[desktop-config] 找不到 label 为 "main" 的窗口。两个窗口都必须显式写 label，闸按 label 取。');
}
// 手动启动必须看得见窗口——否则首次安装后用户找不到入口去填服务器地址。
// 开机自启的隐藏走 --hidden 参数，不靠这个配置。
if (mainWindow.visible !== true) {
  throw new Error("[desktop-config] 主窗口 visible 必须为 true（开机自启的隐藏走 --hidden 参数，不改这里）");
}

// 速记浮窗：热键唤起的临时输入条。四条属性任缺一条都会让它变成一个普通窗口——
// 有标题栏、占任务栏、被别的窗口盖住、启动时糊在屏幕上。
const captureWindow = byLabel.get("capture");
if (!captureWindow) {
  throw new Error('[desktop-config] 找不到 label 为 "capture" 的速记浮窗。');
}
for (const [key, expected] of [
  ["visible", false],
  ["decorations", false],
  ["skipTaskbar", true],
  ["alwaysOnTop", true],
  ["resizable", false],
]) {
  if (captureWindow[key] !== expected) {
    throw new Error(`[desktop-config] 浮窗 capture.${key} 必须是 ${expected}，当前：${JSON.stringify(captureWindow[key])}`);
  }
}
if (captureWindow.url !== "index.html?window=capture") {
  throw new Error(
    `[desktop-config] 浮窗 url 必须是 index.html?window=capture，当前：${JSON.stringify(captureWindow.url)}。` +
      "前端靠这个 query 分流到极简入口；改了它浮窗会加载完整应用，于是挂上第二个热键桥、一次打点落两条记录。",
  );
}

// capabilities 的 windows 授权列表与 tauri.conf.json 的窗口集合必须一致。
// 漏加一个 label：窗口建得出来、却拿不到任何 IPC 权限，前端 catch 是空的、完全静默——
// 表现为「热键唤起后什么都没发生」。加窗口与开权限是同一个原子改动。
const capabilities = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
const capWindows = [...(capabilities.windows ?? [])].sort();
const confLabels = windows.map((w) => w.label).sort();
if (JSON.stringify(capWindows) !== JSON.stringify(confLabels)) {
  throw new Error(
    `[desktop-config] capabilities/default.json 的 windows 是 ${JSON.stringify(capWindows)}，` +
      `而 tauri.conf.json 声明的窗口是 ${JSON.stringify(confLabels)}。两者必须逐个相等——` +
      "少一个的那个窗口所有 IPC 会被权限层静默拒掉。",
  );
}

// ---- 跨语言契约：热键事件名两端必须逐字相同 ----
// Rust `app.emit(name, …)` 与前端 `listen(name, …)` 之间没有共享类型，typecheck 管不到
// 字符串字面量。打错一个字母：注册成功、按键有反应、Rust 侧照常 emit，前端永远收不到，
// 整条打点链路静默失效且没有任何报错。
//
// 闸是**全匹配**而不是「文件里出现过一次」：`commands.rs` 有两处 emit（实时投递、就绪后补投），
// 「出现过一次」的写法在改事件名时只改到第一处就照绿——日常按键正常，唯独「WebView 就绪前
// 排队的那批」发的是旧名字、前端永远收不到。因此：Rust 侧字面量只准活在 hotkeys.rs 的常量里，
// commands.rs 里一处裸字面量 emit 都不许有；前端 listen 的名字集合必须恰好等于那个常量。
const HOTKEY_EVENT_CONST = /pub const HOTKEY_EVENT: &str = "([^"]+)";/;
const rustHotkeys = readFileSync(new URL("../src-tauri/src/hotkeys.rs", import.meta.url), "utf8");
const declared = HOTKEY_EVENT_CONST.exec(rustHotkeys);
if (!declared) {
  throw new Error(
    '[desktop-config] packages/desktop/src-tauri/src/hotkeys.rs 里找不到 `pub const HOTKEY_EVENT: &str = "…";`。' +
      "热键事件名的 Rust 侧字面量只准出现在这一处——两端一致靠本闸比对它，常量没了闸就没有比对对象。",
  );
}
const HOTKEY_EVENT_NAME = declared[1];

// 扫描面是 src-tauri/src 下所有 .rs，不只 commands.rs：投递已经挪进了 deliver_to_webview，
// 将来还可能再挪。正则也从只认 `app.emit(` 放宽到三种发射形态——原正则只认 emit，
// 而本批的改法字面就是 emit_to，正好绕开它，闸会静默失效。
const RUST_SRC = new URL("../src-tauri/src/", import.meta.url);
const EMIT_CALL = /\b\w+\.(?:emit|emit_to|emit_filter)\(\s*(?:&?\w+\s*,\s*)?"([^"]+)"/g;
for (const entry of readdirSync(RUST_SRC, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".rs")) continue;
  const source = readFileSync(new URL(entry.name, RUST_SRC), "utf8");
  const literalEmits = [...source.matchAll(EMIT_CALL)].map((match) => match[1]);
  if (literalEmits.length > 0) {
    throw new Error(
      `[desktop-config] packages/desktop/src-tauri/src/${entry.name} 里有裸字面量 emit：${JSON.stringify(literalEmits)}。` +
        "事件名一律用 hotkeys.rs 的 HOTKEY_EVENT 常量——发射点不止一处，各写一遍字面量时改名很容易漏掉补投那处，" +
        "而漏掉的表现是「开机第一秒按下的那批永远收不到」，没有任何报错。",
    );
  }
}

const clientApi = readFileSync(new URL("../../client/src/lib/desktop/api.ts", import.meta.url), "utf8");
const listened = [...clientApi.matchAll(/listen<[^>]*>\(\s*"([^"]+)"/g)].map((match) => match[1]);
const listenedSet = [...new Set(listened)].sort();
if (listenedSet.length !== 1 || listenedSet[0] !== HOTKEY_EVENT_NAME) {
  throw new Error(
    `[desktop-config] packages/client/src/lib/desktop/api.ts 监听的事件名是 ${JSON.stringify(listenedSet)}，` +
      `而 Rust 的 HOTKEY_EVENT 是 "${HOTKEY_EVENT_NAME}"。两端逐字一致才收得到，只改一侧会让打点静默失效。`,
  );
}

// ---- 三端 bundle 隔离：@tauri-apps/api 只准动态 import ----
// Web / Android / iOS 三端吃的是同一份 client 产物。静态 import 会把 Tauri 运行时拉进
// 入口 chunk，在没有 __TAURI_INTERNALS__ 的环境里加载即报错；动态 import 则出独立 chunk，
// 只有 isDesktopShell() gate 内才会去取。这条约定破了没有任何现有门禁会红。
const CLIENT_SRC = new URL("../../client/src/", import.meta.url);
// @tauri-apps/plugin-* 与 @tauri-apps/api 同样会把 Tauri 运行时拉进入口 chunk。
// 原正则只认 api，插件包能穿过全部门禁、然后在 Web/Android/iOS 上加载即报错。
const STATIC_TAURI_IMPORT =
  /\bfrom\s*["']@tauri-apps\/(api|plugin-)|^\s*import\s*["']@tauri-apps\/(api|plugin-)/m;

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
      `[desktop-config] packages/client/src/${shown} 静态 import 了 @tauri-apps 运行时包（api 或 plugin-*）。` +
        `只准写 await import("@tauri-apps/api/…") 且要在 isDesktopShell() gate 之内，否则三端 bundle 会把 Tauri 运行时打进入口 chunk。` +
        `需要类型就在 lib/desktop/api.ts 里自己声明（现有 DTO 就是这么写的）。`,
    );
  }
}

console.log("[desktop-config] snapshot checks passed");
