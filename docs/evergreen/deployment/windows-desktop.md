---
type: evergreen
title: 部署 · Windows 桌面壳
covers:
  - packages/desktop/**
  - scripts/desktop-version.mjs
  - packages/client/src/lib/desktop/**
  - packages/client/src/components/desktop/**
  - packages/client/src/pages/settings/SettingsDesktopPage.tsx
contracts:
  - packages/desktop/src-tauri/tauri.conf.json
  - .github/workflows/mobile-release.yml
  - packages/desktop/src-tauri/src/config.rs
last-reviewed: 2026-08-03
---

# 部署 · Windows 桌面壳

> [deployment](../deployment.md) 的 Windows 发布子文档：Tauri 壳的构成、托盘与关窗语义、开机自启判定、全局热键与热键打点、NSIS 安装包发布链路、桌面壳的数据边界。
> 不讲 Android 签名与 Gradle（见 [deployment/android-apk](android-apk.md)）、iOS 原生补丁（见 [deployment/ios-ipa](ios-ipa.md)），也不讲服务器镜像与自更新（见 [deployment](../deployment.md)）。

## 承上启下

- **上游**：`main` 的 GitHub Actions windows runner、`packages/client` 的 `mode=mobile` 构建产物、Windows 自带的 WebView2 运行时。
- **下游**：`TimeData-Setup.exe` artifact、`v<code>` GitHub Release（与 Android / iOS 共用）、用户机器上的 `%LOCALAPPDATA%\TimeData`。
- **契约**：`--latest` 只由 `android` job 打，`windows` job 不碰；桌面壳吃 `mode=mobile` 产物，不吃默认构建；应用 identifier 为 `icu.yanzhou.timedata`。client 里的桌面专属代码一律包在 `isDesktopShell()` gate 内，`@tauri-apps/api` 只准动态 `await import(...)`——三端（Web / Android / iOS）吃的是同一份 client 产物，静态 import 会把 Tauri 运行时打进入口 chunk，在没有 `__TAURI_INTERNALS__` 的环境里加载即报错。
- **邻居**：[deployment/android-apk](android-apk.md) / [deployment/ios-ipa](ios-ipa.md)（同一条发布链路的另两个平台）、[sync](../sync.md)（桌面壳作为又一个同步客户端）、[timeline](../timeline.md)（`punchNow` 与圆环打点的本体，热键打点复用它写库）、[categories-settings/settings-catalog](../categories-settings/settings-catalog.md)（打点分类等设置 key）。

## 1. 壳的构成

`packages/desktop` 是 Tauri v2 工程，Rust 侧只做壳：窗口、托盘、关窗拦截、开机自启，不含业务逻辑。前端不单独构建：`tauri.conf.json` 的 `frontendDist` 指向 `../../client/dist`，`beforeBuildCommand` 与 `beforeDevCommand` 都调 `pnpm --filter @timedata/client build:mobile`，吃的是与 Android / iOS 壳同一份产物。

`mode=mobile` 产物不注册 service worker。桌面壳因此不经过网页端 `AppUpdateProvider` 在 `window.focus` 上的版本检查与 `hardRefresh`（注销 service worker、清空 Cache Storage、reload）——常驻壳被热键唤起即得焦点，该链路会在唤起瞬间清缓存并重载页面。选型依据见 [ADR 0029](../../adr/0029-desktop-shell-embeds-frontend.md)。

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

**在应用设置页里关自启是真关得掉的**：设置页的开关除了调插件 `disable()`，还把关闭意图写进 `desktop-config.json` 的 `autostartDisabled`（§4.1）。`resolve_autostart_action` 第一步就读它——`autostartDisabled` 为真时一律 `LeaveAlone`，既不 enable 也不写标记文件，NSIS 升级清掉启动项后也不再恢复。设置页的说明文案据此把用户指回自身（系统层面关不持久、应用里关才持久）。开关重新打开时 `autostartDisabled` 清零、标记文件按当前 exe 路径重写，§3 前两段的自愈判定照旧生效。

## 4. 全局热键与打点

### 4.1 配置文件

`%APPDATA%\icu.yanzhou.timedata\desktop-config.json` 是桌面壳自己的配置文件，**Rust 是唯一写者**，前端读写全部走 IPC 命令。字段：

| 字段 | 语义 |
|---|---|
| `hotkeys` | `[{ shortcut, action }]`，出厂空数组（不带默认键位，装好后在设置页自己配） |
| `punchConfirmHours` | 打点确认阈值（小时），默认 4；非有限值或 `<= 0` 被拒 |
| `autostartDisabled` | 用户在设置页关过自启的意图记录，见 §3 |

`shortcut` 是 Tauri accelerator 字符串，修饰键顺序由前端 `normalizeShortcutFromKeyboardEvent` 钉死为 `Ctrl→Alt→Shift→Super`，与用户按下的先后无关——存进配置的串必须与回显注册结果时用来匹配的串逐字一致。字母 / 数字必须带修饰键（裸键会让正常打字触发全局动作），F1–F24 例外可裸录。`action` 是带参枚举，枚举成员为 `punch` 与 `toggleMain`，序列化格式预留参数位（如 `{ "action": "navigate", "target": "/diary" }`）。

解析两层容错：整个文件坏掉视为默认空配置，不崩溃；单条 `hotkeys` 里认不出的动作跳过、其余照用。坏文件在下次保存时被整体覆盖。落盘走原子写（临时文件 + rename），中途断电不会留下半截 JSON。所有 `load → 改 → save` 形态的 IPC 命令先拿同一把进程内写锁，否则两条并发写命令会交错成「各自基于旧文件改、后写者静默抹掉先写者」。字段定义与解析在 `packages/desktop/src-tauri/src/config.rs`。

`autostart-initialized` 标记文件与本文件职责不同（它记「上次注册自启时的 exe 路径」，见 §3），两者互不覆盖。

### 4.2 注册、分发与排队

- 壳启动读配置即注册热键，**不等 WebView**——开机第一秒按下就有效。启动时的注册失败无处回显（窗口可能还没起来），设置页打开时会通过 `resume_hotkeys` 重新注册并重报结果。
- 设置页保存 → Rust 先 `unregister_all` 再按新表逐条注册 → 返回 `[{ shortcut, action, ok, error }]`。单条失败（组合被别的软件占用、格式非法）不影响其余条目，失败原因在设置页对应行以红字回显。
- 按下时 Rust 记录**按键时刻**（epoch ms）后按动作分流：`toggleMain` 由 Rust 直接办（`resolve_toggle_action`：可见、未最小化且有焦点才 hide，其余一律 show + unminimize + focus——「可见但被别的窗口盖住」按热键是想见到它），不进 WebView，页面卡死也好使；`punch` 带 `{ action, pressedAtMs }` 投递进主窗口 WebView。
- 事件名 `desktop-hotkey` 是 Rust `emit` 与前端 `listen` 之间唯一的约定，两侧都是裸字符串字面量，由配置闸比对（§7）。
- WebView 未就绪时 punch 事件在 Rust 侧 **FIFO 排队**；前端桥挂好监听后 `invoke("desktop_ready")`，Rust 收到即按序补投。`pressedAtMs` 随事件走，因此**执行晚了不影响封口时刻**——开机第一秒按打点，记录的就是那一秒。`toggleMain` 不排队。
- 设置页的快捷键录入框进入录入态时先 `suspend_hotkeys`（注销全部），失焦 / 录完再 `resume_hotkeys`。不挂起的话，录一个本应用已注册的组合时按键会被全局热键吃掉、永远录不上；挂起后不恢复则按一次 Esc 全局热键就永久失效。

### 4.3 punch 全程

按键时刻先向下取整到分钟（与 `punchNow` 一致），然后**先看再写**：查最后一条记录 → `resolvePunchRange` 算区间 → 校验打点分类 → 比阈值。四条出口：

| 情形 | 结果 |
|---|---|
| 区间为 null | 系统通知「距上次记录还没有时间」，不写 |
| 打点分类缺失 / 已归档 | 系统通知「请先在设置里选择打点分类」，不写 |
| 区间时长 > `punchConfirmHours` | 不写，`show_main` 提起主窗口，显示确认卡「要把 HH:mm–HH:mm 记为打点吗？」[记录 / 算了] |
| 阈值内 | 调 `punchNow(pressedAt)` 写入，系统通知「已打点 HH:mm–HH:mm」+ 主窗口挂撤销条 |

确认卡是防打歪的守门员：同步还没拉完时，「上一条记录」可能是几小时前的，直接落笔就是一整段假记录。`desktopPunch(pressedAtMs, maxHours)` 是唯一写入口，**自己守上限**——阈值判定写成否定式 `!(rangeHours(range) <= maxHours)`，`maxHours` 为 `NaN` 或区间含非法 ISO 时倒向弹卡而不是静默放行。

**确认卡上点「记录」后可能再弹一次卡**（副文案变成「刚才那条记录已不在了，区间比你看到的更长」），这不是故障：重试时按当下数据重算，上限用的是**用户批准的那个长度**（`rangeHours(用户看到的区间)`）而不是配置阈值。区间变短直接写（更准），变长则再问一次——同步会传播删除，「重算只会更准」并不成立。

**撤销条**不自动消失（窗口可能整段隐藏，打开时要还在），到下一次热键打点 / 确认操作时被替换，可手动关。撤销 = 删该条记录，与圆环打点撤销同路。页内既有 toast（时间轴页 / 速记页的 `handlePunch`）不动、并存。

系统通知经 notification 插件发，**纯文字**：Windows 桌面端的通知放不了按钮，也拿不到点击回调（底层 `notify-rust` 的 action API 只支持 XDG/Linux）。通知只「告知」，一切可交互的东西都在主窗口。

### 4.4 桥的串行队列

`DesktopBridge` 把全部状态转移排成**一条串行队列**（`queueRef` 链式 `.then`，状态从 `stateRef` 读而非渲染时捕获的 state）。热键连按两下会并发跑两次打点，各自约 8 个 `await` 必然交错：两次都在对方写库前读到同一条「上一条记录」、算出同一区间，于是各写一条**完全重叠**的假记录（`punchNow` 的 `overlapPlan` 为 null，不裁剪）。串行化后第二次看得见第一次写下的记录，正确地报「距上次记录还没有时间」——**连按只落一条是设计结果**。队列的 `catch` 在 `.then` 回调内部——漏在外面时一次 reject 会截断整条链，此后每次打点都静音且无报错。

### 4.5 已知界限：区间判定与落笔不在同一个事务里

区间判定与最终落笔跨**多个独立的 IndexedDB 事务**——`desktopPunch` 的预检读一次、分类校验读三次、`punchNow` 内部重算又读一次。中间约 1–5ms 的窗口里，若同步的 rw 事务恰好删掉锚定区间起点的那条记录，`punchNow` 重算出的区间会比预检时更长，**落笔区间可能超过用户已批准的长度**。这是已知并接受的窗口，不是待发现的 bug。

两条局部闭合路都拿必现风险换极小概率风险，因此都没有采用：给 `punchNow` 加区间下界参数会把桌面策略渗进它的两个既有调用方（时间轴页 / 速记页共用）；把 `desktopPunch` 整体包进一个 Dexie 事务会引入事务 scope 枚举错误与 `await` 逃出 Dexie zone 这类新失败模式，写错就是 100% 的正常打点坏掉。真正的闭合在 `punch.ts` 一侧：把「读锚点 + 写打点」合成一次权威读的原子操作。

### 4.6 模块速查

| 面 | 入口 |
|---|---|
| 配置读写与解析 | `packages/desktop/src-tauri/src/config.rs` |
| 热键排队状态机 | `packages/desktop/src-tauri/src/hotkeys.rs` |
| IPC 命令面与注册装配 | `packages/desktop/src-tauri/src/commands.rs` |
| 纯函数判定（关窗 / 托盘 / 自启 / toggle） | `packages/desktop/src-tauri/src/shell.rs` |
| 桌面壳判定与 IPC 封装 | `packages/client/src/lib/desktop/shell.ts`、`api.ts` |
| 打点预检与自守上限 | `packages/client/src/lib/desktop/desktopPunch.ts` |
| 事件桥 / 撤销条 / 确认卡 | `packages/client/src/components/desktop/DesktopBridge.tsx`、`DesktopPunchLayer.tsx` |
| 快捷键录入与规范化 | `packages/client/src/components/desktop/ShortcutInput.tsx` |
| 设置二级页（`/settings/desktop`，仅桌面壳渲染入口行） | `packages/client/src/pages/settings/SettingsDesktopPage.tsx` |

Rust 单测用 `cargo test` 在 `packages/desktop/src-tauri` 下手动跑，**不挂进 `pnpm --filter @timedata/desktop test`**——门禁机器没有 Rust 工具链。

## 5. 构建与发布

`windows` job 跑在 `windows-latest` runner 上，与 `android` / `ios` 同为 `needs: prepare` 的平台 job，先到先上架。`workflow_dispatch` 的 `platform` 选项含 `windows`，`both` 含全部三个平台；`push` 触发经 `packages/desktop/**` 与 `scripts/desktop-version.mjs` 两条 paths 命中。

版本号有一道转换：发布链路的版本码是 8 位数字 `YYMMDDNN`，Tauri 的 `version` 必须是合法 semver。`scripts/desktop-version.mjs` 的 `codeToSemver` 把它转成 `YY.MMDD.NN`（各段去前导零，`26080301` → `26.803.1`），三级都单调递增。转换结果经 `tauri build --config` 注入，`tauri.conf.json` 里的 `version` 字段不参与发布。

产物是 NSIS 安装包，`bundle.targets` 恰好为 `["nsis"]`。bundler 输出名带版本号，发布前统一改名为 `TimeData-Setup.exe`。安装包不做代码签名，SmartScreen 会拦一次。安装位置是 `%LOCALAPPDATA%\TimeData`，开始菜单快捷方式为 `TimeData.lnk`。

`windows` job 不执行 `gh release edit --latest`——latest 归属规则见 [deployment/ios-ipa](ios-ipa.md) §4。

## 6. 数据边界

Tauri 用独立的 WebView2 用户数据目录，与 Edge / Chrome 的 profile 不互通。桌面壳因此是本机上又一份独立的 IndexedDB，与浏览器里访问同一站点的数据互不可见，两者只能通过服务器同步汇合——与 Capacitor 壳和 PWA 的关系同构（见 [deployment/ios-ipa](ios-ipa.md) §5）。首次启动是空数据，需在设置里填 API 地址与 Token。

同一个 Tauri 应用内的多个窗口共享同一个 WebView2 用户数据目录，因此共用同一份 IndexedDB。

## 7. 配置闸

`packages/desktop/scripts/check-desktop-config.mjs` 随 `pnpm --filter @timedata/desktop test` 运行，守三类「配错了没有任何其他门禁会红」的约定：

1. **`tauri.conf.json` 快照**：`frontendDist` 为 `../../client/dist`、两个 before 命令都调 `build:mobile`、`identifier` 为 `icu.yanzhou.timedata`、`bundle.targets` 恰好 `["nsis"]`、主窗口 `visible` 为 `true`。这些字段配错时构建不一定报错，产出的却是空壳、旧产物或注册了 service worker 的包。
2. **跨语言事件名**：`commands.rs` 与 `packages/client/src/lib/desktop/api.ts` 两侧都必须含字面量 `"desktop-hotkey"`。两端之间没有共享类型，typecheck 管不到字符串字面量；打错一个字母的表现是注册成功、按键有反应、Rust 照常 emit，而前端永远收不到——整条打点链路静默失效且无任何报错。
3. **禁静态 import Tauri API**：扫 `packages/client/src/**/*.{ts,tsx}`，任何 `from "@tauri-apps/api…"` / `import "@tauri-apps/api…"` 形态（含 type-only 与单引号）都报红，只准 `await import(...)`。这是三端 bundle 不加载 Tauri 运行时的唯一保证。需要类型就在 `lib/desktop/api.ts` 里自己声明。

## 8. 排错

- **开机自启指向了旧路径**：标记文件与启动项不同步。删除 `%APPDATA%\icu.yanzhou.timedata\autostart-initialized` 后重新运行一次即可重建。
- **在任务管理器里关了自启，下次启动又回来了**：这是 §3 的判定语义。持久关闭的路径只有一条——应用的「设置 → 桌面设置」，它会把意图记进 `desktop-config.json`。
- **窗口关不掉 / 关了进程还在**：这是设计语义（§2），托盘菜单「退出」才是唯一退出口。
- **热键没反应**：先看「设置 → 桌面设置」里该行有没有红字——有则组合被别的软件占用（换一个），没有则检查是不是录成了裸字母 / 数字（会被判非法而录不进去，见 §4.1）。
- **按了打点却弹出确认卡**：不是故障，是同步没拉完时的防打歪，见 §4.3。
- **热键连按几下只记了一条**：不是故障，是桥的串行队列，见 §4.4。
- **`tauri dev` 下打点没有系统通知**：dev 运行的 exe 没有带 AppUserModelID 的开始菜单快捷方式，Windows 会丢掉这条 toast。通知行为以 NSIS 装机版本为准。
- **开始菜单里看不到条目**：快捷方式在 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\TimeData.lnk`，Windows 开始菜单列表存在索引延迟，搜索能直接命中。
- **NSIS 打包步骤找不到产物**：`bundle.targets` 被改动时 bundler 会产出到别的子目录，`Rename installer` 步骤据 `*-setup.exe` 匹配。
- **桌面版看不到浏览器里记的数据**：不是故障，见 §6。
