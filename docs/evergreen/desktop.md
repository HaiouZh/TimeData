---
type: evergreen
title: Windows 桌面壳
covers:
  - packages/desktop/**
  - packages/client/src/lib/desktop/**
  - packages/client/src/components/desktop/**
  - packages/client/src/pages/settings/SettingsDesktopPage.tsx
  - packages/client/src/capture/**
contracts:
  - packages/desktop/src-tauri/tauri.conf.json
  - packages/desktop/src-tauri/src/shell.rs
last-reviewed: 2026-08-14
---

# Windows 桌面壳

> Tauri 壳的机制主题：壳的构成、托盘与关窗语义、开机自启判定、速记浮窗与双窗口、数据边界、配置闸与排错。
> 不讲全局热键与打点（见子文档 [desktop/hotkeys](desktop/hotkeys.md)）、NSIS 安装包与发布链路（见 [deployment/windows-desktop](deployment/windows-desktop.md)）、移动端两个壳（Android 见 [deployment/android-apk](deployment/android-apk.md)，iOS 见 [deployment/ios-ipa](deployment/ios-ipa.md) 与 [architecture](architecture.md) §4.4–4.6）。

## 承上启下

- **上游**：`packages/client` 的 `mode=mobile` 构建产物、Windows 自带的 WebView2 运行时；安装包来路见 [deployment/windows-desktop](deployment/windows-desktop.md)。
- **下游**：用户机器上的 `%LOCALAPPDATA%\TimeData`、本机又一份独立的 IndexedDB（与浏览器数据只经服务器同步汇合，§6）。
- **契约**：client 里的桌面专属代码一律包在 `isDesktopShell()` gate 内，`@tauri-apps/api` 只准动态 `await import(...)`——三端（Web / Android / iOS）吃的是同一份 client 产物，静态 import 会把 Tauri 运行时打进入口 chunk，在没有 `__TAURI_INTERNALS__` 的环境里加载即报错。应用 identifier 为 `icu.yanzhou.timedata`。
- **邻居**：[desktop/hotkeys](desktop/hotkeys.md)（同主题子文档）、[deployment/windows-desktop](deployment/windows-desktop.md)（发布链路）、[sync](sync.md)（桌面壳作为又一个同步客户端）、[timeline](timeline.md)（`punchNow` 与圆环打点的本体，热键打点复用它写库）、[categories-settings/settings-catalog](categories-settings/settings-catalog.md)（打点分类等设置 key）。

## 1. 壳的构成

`packages/desktop` 是 Tauri v2 工程，Rust 侧只做壳：窗口、托盘、关窗拦截、开机自启，不含业务逻辑。前端不单独构建：`tauri.conf.json` 的 `frontendDist` 指向 `../../client/dist`，`beforeBuildCommand` 与 `beforeDevCommand` 都调 `pnpm --filter @timedata/client build:mobile`，吃的是与 Android / iOS 壳同一份产物。

`mode=mobile` 产物不注册 service worker（`virtual:pwa-register/react` 被 alias 成 no-op hook）。**但 `AppUpdateProvider` 照常挂载**——`main.tsx` 无条件包裹它，`visibilitychange` / `window.focus` 监听照常注册、`hasFrontendUpdate()` 照常调用。桌面壳躲开 `hardRefresh`（注销 service worker、清空 Cache Storage、reload）靠的是**另一件事**：`mode=mobile` 不产出 `/version.json`，`fetchLatestBuildId()` 拿不到就返回 `null`，`hasFrontendUpdate()` 随之恒 `false`。

这个区别不是措辞：常驻壳被热键唤起即得焦点，**一旦哪天桌面产物开始产出 `version.json`，这条链路会立刻活过来**，在唤起瞬间清缓存并重载页面。要挡就得挡在 Provider 或构建产物那一层，不能假设"桌面壳没有这条链路"。选型依据见 [ADR 0029](../adr/0029-desktop-shell-embeds-frontend.md)。

Rust 侧的可判定逻辑集中在 `packages/desktop/src-tauri/src/shell.rs`，全为纯函数（关窗行为、托盘动作路由、启动是否显示窗口、开机自启判定），`main.rs` 只做装配与系统调用。

## 2. 窗口与托盘

主窗口在 `tauri.conf.json` 里 `visible: true`，手动启动即可见。关窗语义是壳「常驻」的全部依据：

- 窗口的 `CloseRequested` 被拦截（`api.prevent_close()`）后隐藏窗口，进程不退。
- 真退出只有一条路：托盘菜单的「退出」先置 `QUITTING` 标记再 `app.exit(0)`，此时 `CloseRequested` 放行。
- 托盘图标左键单击等价于菜单里的「打开 TimeData」；托盘菜单项 id 为 `show` 与 `quit`。

## 3. 开机自启

自启由 `tauri-plugin-autostart` 注册，注册值带 `--hidden` 参数。启动时 `should_show_on_startup` 读命令行：带 `--hidden`（开机被系统拉起）则主窗口启动即隐藏，不带（手动双击）则正常显示。

标记文件 `%APPDATA%\icu.yanzhou.timedata\autostart-initialized` 存**上次注册时的可执行文件路径**。`resolve_autostart_action` 据此判定：**启动项只要不是「已注册到当前这个 exe」，就重新注册并改写标记**。三种情形归一到同一动作——首次运行、可执行文件换了位置（构建产物 → 安装版、重装到别处）、启动项被外部清掉。

NSIS 安装新版本时先卸载旧版本，会一并清掉启动项。该情形与「用户在 Windows 系统设置里关掉自启」在系统层面无法区分，判定取前者：自启在下次启动时恢复。因此**在 Windows 任务管理器 / 系统设置里关闭自启不具持久性**，下次启动会被改回来。

**在应用设置页里关自启是真关得掉的**：设置页的开关除了调插件 `disable()`，还把关闭意图写进 `desktop-config.json` 的 `autostartDisabled`（见 [desktop/hotkeys](desktop/hotkeys.md) §1）。`resolve_autostart_action` 第一步就读它——`autostartDisabled` 为真时一律 `LeaveAlone`，既不 enable 也不写标记文件，NSIS 升级清掉启动项后也不再恢复。设置页的说明文案据此把用户指回自身（系统层面关不持久、应用里关才持久）。开关重新打开时 `autostartDisabled` 清零、标记文件按当前 exe 路径重写，§3 前两段的自愈判定照旧生效。

## 4. 全局热键与打点（子文档）

配置文件 `desktop-config.json` 的字段与三态读、热键注册分发与两把锁的锁序、打点四条出口与确认卡、桥的串行队列、`navigate` 动作，以及「区间判定与落笔不同事务」「存量绑定被上游变更抹掉」两条已知界限，见子文档 [desktop/hotkeys](desktop/hotkeys.md)。

## 5. 速记浮窗与双窗口

壳里有两个窗口，都在 `tauri.conf.json` 里静态声明，进程起来就都在（不是「用时才建」）：

| label | 加载 | 起手可见 | 收哪些动作 |
|---|---|---|---|
| `main` | `index.html` | 是（`--hidden` 启动时隐藏，§3） | `punch` |
| `capture` | `index.html?window=capture` | 否 | `capture` |

`toggleMain` 不投任何窗口——`shell::target_window` 对它返回 `None`，Rust 侧直办。

浮窗是一条无边框、置顶、不进任务栏、不可缩放的输入框（600×120）。按 capture 热键唤起、打字、回车存进速记，窗口闪一下「已记下」随即隐藏；存失败则窗口不走、红字报错、字留在框里。Esc 直接隐藏，没存完的半句留在草稿里。

### 5.1 一份产物、两个角色

`main.tsx` 顶层按 `isCaptureWindow()` 分流，两条分支是**互斥的整棵树**：浮窗分支只渲染 `CaptureApp`，不含 `AppUpdateProvider` / `DesktopBridge` / `SyncProvider` / 路由，也不跑 `runStartupTasks()`；主窗口分支照旧。

**分流必须在 `main.tsx` 这一层，不能挪进 `App` 内部。** `DesktopBridge` 挂在 `App.tsx` 里、条件是 `isDesktopShell()`——浮窗同样满足这个条件，一旦它走到 `App` 就会挂上第二个桥。届时一次 `punch` 热键被两个桥各收一次（Rust 的 `app.emit` 是广播），落两条重复记录。下一节的点名投递是这件事的第二道保险，两道都在，少一道都不该。

`isCaptureWindow()` 先判 `isDesktopShell()` 再看 query：三端吃的是同一份产物，浏览器里手敲 `/?window=capture` 必须渲染完整应用而非浮窗（`shell.test.ts` 有这条闸）。

`CaptureApp` 是静态 import 进 `main.tsx` 的，因而进入口 chunk——源码 7.3 KB、gzip 后约 2 KB，占入口 chunk 的 3–4%。**不改 `lazy()`**：动态加载要给浮窗多一次 import 往返，而浮窗的全部价值就是「按下即出」。判据是它在入口 chunk 里的占比，不是它自己的绝对大小。

### 5.2 点名投递与按 label 分组的就绪队列

Rust 侧不广播热键事件，按 `shell::target_window` 的映射表**点名投递**到目标窗口（`deliver_to_webview` 把「排队」与 `emit_to` 绑在一起，两者不会走岔）。

就绪队列按 label 分组（`HotkeyDispatcher` 的 `ready: HashSet<String>` + `queues: HashMap<String, VecDeque<_>>`）：某个窗口的 WebView 还没就绪时，投给它的事件排进它自己那条队，`desktop_ready` 到达时只冲它自己那条。不分组的话，先就绪的窗口会把另一个窗口的积压一并领走。

**`desktop_ready` 的 label 取自 `window.label()`，不是前端传参**——前端传错会让某个窗口的积压永远排不出去，而 `window.label()` 是权威来源、错不了。

### 5.3 已知界限：浮窗写的速记最多 60 秒后才同步

`syncScheduler` 是**模块级单例**，每个 WebView 各有一份，而浮窗那份不跑（它没挂 `SyncProvider`）。浮窗写进 IndexedDB 的速记因此不会立刻触发上行同步，捞它的是主窗口那份的兜底轮询（`SYNC_FALLBACK_INTERVAL_MS`，60 秒）。

也就是说：浮窗记完，最坏 60 秒后手机上才看得到。这是**已知并接受的界限**，不是待修的 bug。让浮窗自己起一套同步栈，与「按下即出、存完即走」的取向冲突。

### 5.4 草稿是独立的 key

浮窗草稿存 `captureComposerDraft`，**与速记页的草稿 key 不共用**。共用的话，浮窗里打了一半按 Esc 收起，再打开速记页会看到那半句凭空出现在输入框里，反之亦然。

### 5.5 焦点与前台锁

「按下热键 → 浮窗拿到键盘焦点」这条在 Windows 上**不是必然的**：前台锁会把 `set_focus` 降级成任务栏闪烁（[desktop/hotkeys](desktop/hotkeys.md) §3 的确认卡撞过同一件事）。实现是直白的 `show` + `set_focus`，能不能真拿到焦点由系统裁决，三种场景各不相同：别的应用正在接收键盘输入、别的应用全屏、短时间内连续唤起。

**Rust 侧查不出抢没抢到**：`show_capture_window` 是无条件的 `show` + `unminimize` + `set_focus`，三句的失败都被 `let _ =` 吞掉；但前台锁**根本不算失败**——它把 `set_focus` 降级后照样返回 Ok，所以查那三句的返回值查不出焦点归属。焦点落在谁身上，只有拿到焦点的那一端知道。

**故由浮窗自己观测并自报**：`CaptureApp` 读 `document.hasFocus()`（并监听 window 的 focus / blur），没拿到焦点时在输入框下方显示一行提示。这条落点**不经通知通道**——浮窗本就在屏幕正中，而系统通知会被专注助手或权限设置吞掉（[desktop/hotkeys](desktop/hotkeys.md) §3「每条出口都要有一个不经通知通道的落点」同一条判据）。提示只在 idle 态出现，`saving` / `saved` / `error` 各有各的话要说，同时挂两条反而看不清。

**主窗口侧仍无兜底**：`show_main_window` 同形状的三句 `let _ =`，`toggleMain` 与 navigate 都复用它。主窗口抢不到焦点的后果轻得多——窗口显示出来就看得见，不构成「看着能打字却打进别处」的半开状态，故按已知界限留着。

补兜底时的判据是**宁可不显示窗口 + 发通知，也不留半开状态**——半开比不出现更糟。

### 5.6 三道闸各守什么

| 闸 | 守什么 | 何时跑 |
|---|---|---|
| `check-desktop-config.mjs` | 两个窗口按 label 的属性快照、跨语言事件名全匹配、禁静态 import Tauri（§7）、capabilities 授权列表 == `tauri.conf.json` 的窗口集合 | `pnpm --filter @timedata/desktop test` |
| `check-hotkey-actions.mjs` | 动作名在**四处**一致：Rust `action_id` / `api.ts` 联合类型 / 设置页 `ACTION_OPTIONS` / 消费分支 | 同上 |
| `pnpm check:desktop` | 上面两道 + `cargo test` + `cargo clippy -D warnings` | 手动，碰了 `packages/desktop/**` 必跑 |

`check-hotkey-actions.mjs` 存在的理由：设置页的 `ACTION_OPTIONS` 漏一个动作时**没有任何测试会红**，但用户在「桌面设置」里根本选不到那个动作——热键配不上。

消费分支那一条守的是：凡是 `target_window` 返回 `Some` 的动作，必须在**对应窗口**的消费文件里有一处 `event.action === "<id>"`；返回 `None` 的必须一处都没有。不这样守的话，加动作时把三处声明点改全、漏掉消费分支 → 设置页选得到、热键注册成功、按下去零反应，而编译、全部测试、两道闸全绿。按窗口精确匹配而不是扫两个文件的并集，是因为并集守不住「写错窗口」——把 navigate 的处理写进 `CaptureApp` 照样绿，而那条分支永远触发不到。

capabilities 那一条守的是另一个同形的洞：新增窗口时 `tauri.conf.json` 加了 label 却漏了 `capabilities/default.json` 的 `windows` 列表，该窗口的 WebView 拿不到任何 IPC 权限——构建、测试、其余断言全绿，装机后那个窗口一片空白。

## 6. 数据边界

Tauri 用独立的 WebView2 用户数据目录，与 Edge / Chrome 的 profile 不互通。桌面壳因此是本机上又一份独立的 IndexedDB，与浏览器里访问同一站点的数据互不可见，两者只能通过服务器同步汇合——与 Capacitor 壳和 PWA 的关系同构（见 [deployment/ios-ipa](deployment/ios-ipa.md#deployment-ios-ipa-s5)）。首次启动是空数据，需在设置里填 API 地址与 Token。

同一个 Tauri 应用内的多个窗口共享同一个 WebView2 用户数据目录，因此共用同一份 IndexedDB。

## 7. 配置闸

`packages/desktop/scripts/check-desktop-config.mjs` 随 `pnpm --filter @timedata/desktop test` 运行，守四类「配错了没有任何其他门禁会红」的约定：

1. **`tauri.conf.json` 快照**：`frontendDist` 为 `../../client/dist`、两个 before 命令都调 `build:mobile`、`identifier` 为 `icu.yanzhou.timedata`、`bundle.targets` 恰好 `["nsis"]`。窗口按 **label** 取（不按数组下标），主窗口 `visible` 为 `true`，浮窗的 `url` 与 `visible` / `decorations` / `skipTaskbar` / `alwaysOnTop` / `resizable` 五项逐一断言——浮窗少一项 `decorations: false` 就是一个带标题栏的窗口，少一项 `skipTaskbar` 就多一个任务栏图标，都不会让任何测试变红。这些字段配错时构建不一定报错，产出的却是空壳、旧产物或注册了 service worker 的包。
2. **跨语言事件名（全匹配）**：`hotkeys.rs` 必须声明 `pub const HOTKEY_EVENT: &str = "…";`；`src-tauri/src/` 下**任何 `.rs` 里一处裸字面量 emit 都不许有**（正则覆盖 `emit` / `emit_to` / `emit_filter` 三种形态，集合必须为空——只认 `app.emit(` 的话，改用 `emit_to` 点名投递的那条路径会整个绕开闸）；`api.ts` 里 `listen<…>("…")` 的名字集合必须恰好等于那个常量的值。闸不能写成「文件里出现过一次」——`commands.rs` 有两处 emit（实时投递、就绪后补投），那种写法在改名时只改到第一处就照绿：日常按键正常，唯独「WebView 就绪前排队的那批」发的是旧名字、前端永远收不到，正好打掉 [desktop/hotkeys](desktop/hotkeys.md) §2 承诺的「开机第一秒按下也生效」。两端之间没有共享类型，typecheck 管不到字符串字面量。
3. **禁静态 import Tauri API**：扫 `packages/client/src/**/*.{ts,tsx}`，任何 `from "@tauri-apps/api…"` / `import "@tauri-apps/api…"` 形态（含 type-only 与单引号）都报红，只准 `await import(...)`。这是三端 bundle 不加载 Tauri 运行时的唯一保证。需要类型就在 `lib/desktop/api.ts` 里自己声明。
4. **capabilities 授权列表 == 窗口集合**：`capabilities/default.json` 的 `windows` 列表必须逐字等于 `tauri.conf.json` 的窗口 label 集合。新增窗口时漏改 capabilities，构建 / 测试 / 其余断言全绿，装机后那个窗口却一片空白（§5.6）。

## 8. 排错

- **桌面版报「网络请求失败：无法连接 …」而同一台电脑的浏览器访问正常**：桌面壳的 WebView origin 是 `http://tauri.localhost`（Windows；macOS/Linux 为 `tauri://localhost`），访问服务端一律**跨域**，所有请求都要过 CORS。该 origin 由服务端代码内置放行（[ADR 0030](../adr/0030-shell-origins-allowed-by-server-code.md)），但服务端镜像早于该改动时会被拒——判据是 `curl -sS -i -X OPTIONS https://<host>/api/health -H "Origin: http://tauri.localhost" -H "Access-Control-Request-Method: GET"` 的响应里有没有 `access-control-allow-origin`。缺就升级服务端镜像，或临时把该 origin 填进服务器 `.env` 的 `ALLOWED_ORIGINS`（见 [deployment/configuration](deployment/configuration.md) §1）。fetch 失败分不清「被 CORS 拒」和「真连不上」，所以文案会同时提这两件事。
- **开机自启指向了旧路径**：标记文件与启动项不同步。删除 `%APPDATA%\icu.yanzhou.timedata\autostart-initialized` 后重新运行一次即可重建。
- **在任务管理器里关了自启，下次启动又回来了**：这是 §3 的判定语义。持久关闭的路径只有一条——应用的「设置 → 桌面设置」，它会把意图记进 `desktop-config.json`。
- **窗口关不掉 / 关了进程还在**：这是设计语义（§2），托盘菜单「退出」才是唯一退出口。
- **热键没反应**：先看「设置 → 桌面设置」里该行有没有红字——有则组合被别的软件占用（换一个）；再看有没有「改动要保存才生效」——**改了 / 删了行不点保存是不生效的**，壳里注册着的仍是上次保存的那张表，而且再聚焦任意录入框会按磁盘配置重新注册、把「删掉」的那条装回来；都没有则检查是不是按了裸字母 / 数字（录入框会就地回显「要带 Ctrl / Alt / Shift」）。
- **按了跳转键没反应**：先看「设置 → 桌面设置」那一行有没有红字——有则目标页已失效（多半是路由改过名），重选一个。都没有则看主窗口是不是已经停在那一页了：同页再按是刻意不做任何事的（[desktop/hotkeys](desktop/hotkeys.md) §7）。**主窗口隐藏 / 最小化时失效的表现不是「没反应」**：窗口会被拉出来、页面停在原处——窗口弹出来但没换页 = target 失效（去设置页看红字），不是热键没生效（原因同 [desktop/hotkeys](desktop/hotkeys.md) §7）。
- **在 `?date=` 翻过页的时间轴上按「跳时间轴」没反应**：判据是 pathname，`?date=` 不算另一页。要回今天走时间轴页自己的入口。
- **改了打点确认阈值好像没生效**：填了 0 / 负数 / 非数字时不保存，输入框会自动改回上次存住的值并给出提示。看到「已改回 X」就说明这次没存上。
- **按了打点却弹出确认卡**：不是故障，是同步没拉完时的防打歪，见 [desktop/hotkeys](desktop/hotkeys.md) §3。
- **热键连按几下只记了一条**：不是故障，是桥的串行队列，见 [desktop/hotkeys](desktop/hotkeys.md) §4。
- **`tauri dev` 下打点没有系统通知**：dev 运行的 exe 没有带 AppUserModelID 的开始菜单快捷方式，Windows 会丢掉这条 toast。通知行为以 NSIS 装机版本为准。
- **桌面版看不到浏览器里记的数据**：不是故障，见 §6。

装机侧的排错（SmartScreen、开始菜单条目、CI 产物改名）见 [deployment/windows-desktop](deployment/windows-desktop.md)。

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [desktop/hotkeys](desktop/hotkeys.md) | `desktop-config.json` 字段与三态读、热键注册分发与锁序、打点四条出口与确认卡、桥的串行队列、`navigate` 动作、两条已知界限 |
