---
type: evergreen
title: 部署 · Windows 桌面壳
covers:
  - packages/desktop/**
  - scripts/desktop-version.mjs
  - packages/client/src/lib/desktop/**
  - packages/client/src/components/desktop/**
  - packages/client/src/pages/settings/SettingsDesktopPage.tsx
  - packages/client/src/capture/**
contracts:
  - packages/desktop/src-tauri/tauri.conf.json
  - .github/workflows/mobile-release.yml
  - packages/desktop/src-tauri/src/config.rs
last-reviewed: 2026-08-06
---

# 部署 · Windows 桌面壳

> [deployment](../deployment.md) 的 Windows 发布子文档：Tauri 壳的构成、托盘与关窗语义、开机自启判定、全局热键与热键打点、速记浮窗与双窗口、NSIS 安装包发布链路、桌面壳的数据边界。
> 不讲 Android 签名与 Gradle（见 [deployment/android-apk](android-apk.md)）、iOS 原生补丁（见 [deployment/ios-ipa](ios-ipa.md)），也不讲服务器镜像与自更新（见 [deployment](../deployment.md)）。

## 承上启下

- **上游**：`main` 的 GitHub Actions windows runner、`packages/client` 的 `mode=mobile` 构建产物、Windows 自带的 WebView2 运行时。
- **下游**：`TimeData-Setup.exe` artifact、`v<code>` GitHub Release（与 Android / iOS 共用）、用户机器上的 `%LOCALAPPDATA%\TimeData`。
- **契约**：`--latest` 只由 `android` job 打，`windows` job 不碰；桌面壳吃 `mode=mobile` 产物，不吃默认构建；应用 identifier 为 `icu.yanzhou.timedata`。client 里的桌面专属代码一律包在 `isDesktopShell()` gate 内，`@tauri-apps/api` 只准动态 `await import(...)`——三端（Web / Android / iOS）吃的是同一份 client 产物，静态 import 会把 Tauri 运行时打进入口 chunk，在没有 `__TAURI_INTERNALS__` 的环境里加载即报错。
- **邻居**：[deployment/android-apk](android-apk.md) / [deployment/ios-ipa](ios-ipa.md)（同一条发布链路的另两个平台）、[sync](../sync.md)（桌面壳作为又一个同步客户端）、[timeline](../timeline.md)（`punchNow` 与圆环打点的本体，热键打点复用它写库）、[categories-settings/settings-catalog](../categories-settings/settings-catalog.md)（打点分类等设置 key）。

## 1. 壳的构成

`packages/desktop` 是 Tauri v2 工程，Rust 侧只做壳：窗口、托盘、关窗拦截、开机自启，不含业务逻辑。前端不单独构建：`tauri.conf.json` 的 `frontendDist` 指向 `../../client/dist`，`beforeBuildCommand` 与 `beforeDevCommand` 都调 `pnpm --filter @timedata/client build:mobile`，吃的是与 Android / iOS 壳同一份产物。

`mode=mobile` 产物不注册 service worker（`virtual:pwa-register/react` 被 alias 成 no-op hook）。**但 `AppUpdateProvider` 照常挂载**——`main.tsx` 无条件包裹它，`visibilitychange` / `window.focus` 监听照常注册、`hasFrontendUpdate()` 照常调用。桌面壳躲开 `hardRefresh`（注销 service worker、清空 Cache Storage、reload）靠的是**另一件事**：`mode=mobile` 不产出 `/version.json`，`fetchLatestBuildId()` 拿不到就返回 `null`，`hasFrontendUpdate()` 随之恒 `false`。

这个区别不是措辞：常驻壳被热键唤起即得焦点，**一旦哪天桌面产物开始产出 `version.json`，这条链路会立刻活过来**，在唤起瞬间清缓存并重载页面。要挡就得挡在 Provider 或构建产物那一层，不能假设"桌面壳没有这条链路"。选型依据见 [ADR 0029](../../adr/0029-desktop-shell-embeds-frontend.md)。

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

`shortcut` 是 Tauri accelerator 字符串，修饰键顺序由前端 `normalizeShortcutFromKeyboardEvent` 钉死为 `Ctrl→Alt→Shift→Super`，与用户按下的先后无关——存进配置的串必须与回显注册结果时用来匹配的串逐字一致。字母 / 数字必须带修饰键（裸键会让正常打字触发全局动作），F1–F24 例外可裸录。`action` 是带参枚举，成员为 `punch` / `toggleMain` / `capture` / `navigate`。前三个无参；`navigate` 带一个 `target`（内部标签 + `#[serde(flatten)]` 让它直接落位，见 §4.7）。

**读配置分三态**：文件不存在 → 默认配置（首次启动的正常路径）；**读失败 → `Err`**；读到了 → 解析结果。读失败与文件不存在必须分开——杀软 / OneDrive / 备份工具短暂独占文件的那一瞬，若被当成「还没配过任何东西」，写命令就会拿全默认值（`hotkeys: []`、`autostartDisabled: false`）去做 load→改→**全量覆盖**写回，一次保存抹掉全部快捷键、把关掉的自启重新打开，还返回成功。因此：三个写命令拿到 `Err` 一律**拒绝保存**并把原因抛给前端；`resume_hotkeys` 拿到 `Err` **不碰注册表**（否则一次读不到就等于把当前活着的热键全注销）；启动路径拿到 `Err` 时既不动自启也不注册热键，改发一条系统通知说明本次启动什么都没做（重启即恢复，比上面两件都轻）。

解析两层容错：整个文件坏掉视为默认空配置，不崩溃；单条 `hotkeys` 里认不出的动作跳过、其余照用。**「坏文件在下次保存时被整体覆盖」说的是解析失败（内容真坏了），与上面的读失败不是一回事。**认不出的条目的前向兼容只在**读**路径成立：旧版本的任何一次保存都是全量覆盖，跳过的条目就此永久消失——这是当前接受的行为（Rust 是唯一写者，跨版本回退属罕见操作），`config.rs` 有一条用例把它明写在纸面上。

落盘走原子写（临时文件 + rename），中途断电不会留下半截 JSON。所有 `load → 改 → save` 形态的 IPC 命令先拿同一把进程内写锁，否则两条并发写命令会交错成「各自基于旧文件改、后写者静默抹掉先写者」。**锁与它保护的资源同在 `config.rs`**：纯读改写走 `update_config`（调用方不必记得拿锁），需要在锁内多做一件事的（`set_hotkeys` 写盘后要注册热键、`set_autostart_enabled` 写盘前要开关系统自启）显式取 `config_write_guard`。字段定义与解析在 `packages/desktop/src-tauri/src/config.rs`。

`autostart-initialized` 标记文件与本文件职责不同（它记「上次注册自启时的 exe 路径」，见 §3），两者互不覆盖。

### 4.2 注册、分发与排队

- 壳启动读配置即注册热键，**不等 WebView**——开机第一秒按下就有效。启动时的注册失败无处回显（窗口可能还没起来），设置页打开时会通过 `resume_hotkeys` 重新注册并重报结果。
- 设置页保存 → Rust 先 `unregister_all` 再按新表逐条注册 → 返回 `[{ shortcut, action, ok, error }]`。单条失败（组合被别的软件占用、格式非法）不影响其余条目，失败原因在设置页对应行以红字回显。
- 按下时 Rust 记录**按键时刻**（epoch ms）后按动作分流：`toggleMain` 由 Rust 直接办（`resolve_toggle_action`：可见、未最小化且**在前台**才 hide，其余一律 show + unminimize + focus——「可见但被别的窗口盖住」按热键是想见到它），不进 WebView，页面卡死也好使；`punch` 带 `{ action, pressedAtMs }` 投递进主窗口 WebView。
- 「在前台」的合成与 toggle 判定一起收在 `shell::resolve_toggle_from_window` 里，`commands.rs` 只负责取六个原始值（可见 / 最小化 / `is_focused()` / 前台原始句柄 / 归一后的句柄 / 本窗口句柄）、一句判断都不做——归一那步留在装配层时没有任何测试锁得住它。判定本身**两路取或**：tao 的 `is_focused()`，或 Win32 `GetForegroundWindow()` 经 `GetAncestor(GA_ROOT)` 归一后等于本窗口 HWND。只信前者不够——WebView2 子窗口吃走键盘焦点后，它在窗口明明处于最前时报 false，toggleMain 于是每次都走 show、**再也收不起来**。归一那步不能省：前台往往正是本应用自己的 WebView2 子窗口。两路取或而非只留 Win32 一路，方向是「宁可收起」：误判 hide 多按一次就自愈，误判 show 是按多少次都出不来的死局。句柄 0（无前台窗口 / `hwnd()` 取不到）不参与相等比较，否则「两边都拿不到」会被当成「前台就是我」。这六个值**各有自己的 newtype**（`Visible` / `Minimized` / `ForegroundRaw` / `AncestorRoot` / `SelfHwnd`），在取值那一处就套上、不在调用处现包：相邻同类型参数写反是真值表锁不到的一类错——两个句柄对调的效果恰是「拿未归一的原始句柄去比」，套上之后它是编译错误。
- **热键注册表另有一把锁**，与配置文件写锁分开：注册表有三个写者（`set_hotkeys` / `suspend_hotkeys` / `resume_hotkeys`），而只护配置文件不够——点一次「保存快捷键」这个动作本身就会先 blur 录入框发出 `resume_hotkeys`、再发出 `set_hotkeys`，两条 promise 互不等待。交错时 `resume` 的 `unregister_all` 会落在 `set_hotkeys` 注册完之后，抹掉新表装回旧表：文件里是新表、页面显示全绿、系统里跑的是旧表。碰注册表的函数收 `RegistryGuard` 引用，**漏拿锁编译不过**。前端把录入态的 `suspend` / `resume` 串成一条链是必要配套，但不充分。
- **拿到锁只是一半：`resume_hotkeys` 的读也必须在注册表锁内。**互斥只保证两条命令不交错，**不保证顺序**——`resume_hotkeys` 若在锁外先 `load_config`，读到的可能是 `set_hotkeys` 落盘前的旧表；等它排到锁，`set_hotkeys` 早已写完文件、装好新表并全部释放，`resume` 这才按旧表 `unregister_all` 加重注册，把上面那个终态原样复现一遍。所以它**先 `lock_registry()` 再 `load_config`**，这两句的顺序不能倒。
    另两个写者各是各的形状，不存在「三个写者同一条锁序」这回事：`suspend_hotkeys` 只拿注册表锁注销，根本不读配置；`set_hotkeys` 在**配置写锁**内走 load→改→全量写回，之后才拿注册表锁按刚落盘的新表重注册——它装的就是自己刚写的那份，不存在读到旧表的窗口。`RegistryGuard` 拦得住「漏拿锁」，拦不住「在锁外先读」——后者没有编译期或测试期的闸，只有这一条与 `resume_hotkeys` 上的注释记着。锁内读不会死锁：`load_config` 只读文件、不碰配置写锁，两把锁之间无环。`main.rs` 的 `setup` 同样是配置在上、锁在下，但它跑在事件循环启动之前，三个写注册表的命令此刻一条都派发不出来，别把这个顺序照搬进命令里。
- 事件名 `desktop-hotkey` 是 Rust `emit` 与前端 `listen` 之间唯一的约定。**Rust 侧的字面量只准出现在 `hotkeys.rs` 的 `HOTKEY_EVENT` 常量里**（`commands.rs` 有两处 emit，各写一遍字面量时改名极易漏掉补投那处），由配置闸全匹配比对（§8）。
- WebView 未就绪时 punch 事件在 Rust 侧 **FIFO 排队**；前端桥挂好监听后 `invoke("desktop_ready")`，Rust 收到即按序补投。`pressedAtMs` 随事件走，因此**执行晚了不影响封口时刻**——开机第一秒按打点，记录的就是那一秒。`toggleMain` 不排队。
- 设置页的快捷键录入框进入录入态时先 `suspend_hotkeys`（注销全部），失焦 / 录完再 `resume_hotkeys`。不挂起的话，录一个本应用已注册的组合时按键会被全局热键吃掉、永远录不上；挂起后不恢复则按一次 Esc 全局热键就永久失效。

### 4.3 punch 全程

按键时刻先向下取整到分钟（与 `punchNow` 一致），然后**先看再写**：查最后一条记录 → `resolvePunchRange` 算区间 → 校验打点分类 → 比阈值。四条出口：

| 情形 | 结果 |
|---|---|
| 区间为 null | 不写。系统通知「距上次记录还没有时间」**+ 窗口内提示条**，并清掉停留中的确认卡 |
| 打点分类缺失 / 已归档 | 不写。系统通知「请先在设置里选择打点分类」**+ `show_main` + 窗口内提示条**，并清掉停留中的确认卡 |
| 区间时长 > `punchConfirmHours` | 不写，`show_main` 提起主窗口 + 一条通知，显示确认卡「要把 HH:mm–HH:mm 记为打点吗？」[记录 / 算了] |
| 阈值内 | 调 `punchNow(pressedAt)` 写入，系统通知「已打点 HH:mm–HH:mm」+ 主窗口挂撤销条 |

**每条出口都要有一个不经通知通道的落点**：系统通知两端各吞一次（Rust 的 `let _ = …show()`、桥的 `quietly`），专注助手开着或通知权限关了就是屏幕上零变化。只有通知的话，全新装机必然撞上的那条（§7 首次启动是空数据 → 没配打点分类 → 按热键走第二条）就是不写库、不提窗、无红字，用户会去查热键注册（设置页全绿），真正的原因被静默丢掉。`needsConfirm` 也发通知：Windows 的前台锁会把 `set_focus` 降级成任务栏闪烁，只靠 `show_main` 时这次按键可以是零可观察结果。队列里抛出的失败同样两条路都给（提示条 + 通知），原因文本用 `messageOf` 读——**Tauri 的 invoke 失败 reject 的是字符串**（Rust 的 `Err(String)`），只认 `Error` 的写法会把 Rust 写的原因换成一句无信息的兜底词。

「不写」的两条出口清掉停留中的确认卡：卡上的区间是按下那一刻算的，走到这两条说明当下数据已经不支持它了，留着就是「通知说没时间可记、屏幕上却挂着一张要你记 00:00–12:00 的卡」。

确认卡是防打歪的守门员：同步还没拉完时，「上一条记录」可能是几小时前的，直接落笔就是一整段假记录。`desktopPunch(pressedAtMs, maxHours)` 是唯一写入口，**自己守上限**——阈值判定写成否定式 `!(rangeHours(range) <= maxHours)`，`maxHours` 为 `NaN` 或区间含非法 ISO 时倒向弹卡而不是静默放行。

**确认卡上点「记录」后可能再弹一次卡**（副文案变成「刚才那条记录已不在了，区间比你看到的更长」），这不是故障：重试时按当下数据重算，上限用的是**用户批准的那个长度**（`rangeHours(用户看到的区间)`）而不是配置阈值。区间变短直接写（更准），变长则再问一次——同步会传播删除，「重算只会更准」并不成立。

确认卡弹出时**焦点直接落在「记录」上，Esc = 算了**：用户刚按完热键、手还在键盘上，焦点不进卡片就只剩鼠标一条路。

**撤销条**不自动消失（窗口可能整段隐藏，打开时要还在），到下一次热键打点 / 确认操作时被替换，可手动关。撤销 = 删该条记录，与圆环打点撤销同路。页内既有 toast（时间轴页 / 速记页的 `handlePunch`）不动、并存。

系统通知经 notification 插件发，**纯文字**：Windows 桌面端的通知放不了按钮，也拿不到点击回调（底层 `notify-rust` 的 action API 只支持 XDG/Linux）。通知只「告知」，一切可交互的东西都在主窗口。

### 4.4 桥的串行队列

`DesktopBridge` 把全部状态转移排成**一条串行队列**（`queueRef` 链式 `.then`，状态从 `stateRef` 读而非渲染时捕获的 state）。热键连按两下会并发跑两次打点，各自约 8 个 `await` 必然交错：两次都在对方写库前读到同一条「上一条记录」、算出同一区间，于是各写一条**完全重叠**的假记录（`punchNow` 的 `overlapPlan` 为 null，不裁剪）。串行化后第二次看得见第一次写下的记录，正确地报「距上次记录还没有时间」——**连按只落一条是设计结果**。队列的 `catch` 在 `.then` 回调内部——漏在外面时一次 reject 会截断整条链，此后每次打点都静音且无报错。

**用户动作进队列时要带身份**：他点下去那一刻屏幕上的那张卡 / 那条撤销条本身（对象引用），执行时比对不上就原样返回。一次打点在队列里要跑几十~几百毫秒，这个窗口里点「撤销」的话，队列会先跑完新打点、把撤销条换成新写的那条，再轮到这一下——删掉的是新的、不是他看着的那条；「✕」「算了」同形状。身份**用对象引用而不是 `entryId` / `pressedAtMs` 这类字段值**：确认卡重试时新卡的 `pressedAtMs` 与原卡相同（同一次按键），字段比对会放行「双击『记录』」，第二下按新卡那个更长的已批准长度落笔——正是 §4.3 那条 Critical 的失败形态。

**提示条是唯一的例外，身份按文案比。**它只有 `message` 一个字段、屏幕上长什么样完全由它决定，而三个生产者（`noRange` / `missingCategory` / 队列 `catch`）每次都现造新对象：文案相同的两条对用户完全无从分辨，引用比对在那里退化成「点了 ✕ 没反应」——屏幕上文字前后一个字不差。比对放在消费端（`dismissNotice`）而不是让生产者「文案没变时沿用原对象」：后者要三处各自记得，漏一处就复现同一个症状且不会红。撤销条与确认卡不适用：它们身份一变文案必变，用户看得出换了一条。

### 4.5 已知界限：区间判定与落笔不在同一个事务里

区间判定与最终落笔跨**多个独立的 IndexedDB 事务**——`desktopPunch` 的预检读一次、分类校验读三次、`punchNow` 内部重算又读一次。中间约 1–5ms 的窗口里，若同步的 rw 事务恰好删掉锚定区间起点的那条记录，`punchNow` 重算出的区间会比预检时更长，**落笔区间可能超过用户已批准的长度**。这是已知并接受的窗口，不是待发现的 bug。

两条局部闭合路都拿必现风险换极小概率风险，因此都没有采用：给 `punchNow` 加区间下界参数会把桌面策略渗进它的两个既有调用方（时间轴页 / 速记页共用）；把 `desktopPunch` 整体包进一个 Dexie 事务会引入事务 scope 枚举错误与 `await` 逃出 Dexie zone 这类新失败模式，写错就是 100% 的正常打点坏掉。真正的闭合在 `punch.ts` 一侧：把「读锚点 + 写打点」合成一次权威读的原子操作。

相邻的一件事：`desktopPunch` 的区间推导是 `punchNow` 那四行的**复刻**（预检要在不写库的前提下先算出区间给用户看）。分叉的后果不是「算错」，而是守门员守错了对象——卡上给用户看的区间、以及自守闸比对的，都是旧规则算的，落笔的却是新规则算的。两侧各有互指注释，`desktopPunch.test.ts` 有一条跨文件一致性用例（同一份库状态下两处算出的区间必须逐字相同），分叉时它会红。

### 4.6 模块速查

| 面 | 入口 |
|---|---|
| 配置读写与解析 | `packages/desktop/src-tauri/src/config.rs` |
| 热键排队状态机 | `packages/desktop/src-tauri/src/hotkeys.rs` |
| IPC 命令面与注册装配 | `packages/desktop/src-tauri/src/commands.rs` |
| 纯函数判定（关窗 / 托盘 / 自启 / toggle） | `packages/desktop/src-tauri/src/shell.rs` |
| 桌面壳判定与 IPC 封装 | `packages/client/src/lib/desktop/shell.ts`、`api.ts` |
| 打点预检与自守上限 | `packages/client/src/lib/desktop/desktopPunch.ts` |
| navigate 目标页裁定（唯一的页面清单） | `packages/client/src/lib/desktop/navigateAction.ts` |
| 事件桥 / 撤销条 / 确认卡 | `packages/client/src/components/desktop/DesktopBridge.tsx`、`DesktopPunchLayer.tsx` |
| 快捷键录入与规范化 | `packages/client/src/components/desktop/ShortcutInput.tsx` |
| 设置二级页（`/settings/desktop`，仅桌面壳渲染入口行） | `packages/client/src/pages/settings/SettingsDesktopPage.tsx` |
| 速记浮窗与草稿 | `packages/client/src/capture/CaptureApp.tsx`、`captureDraft.ts` |

Rust 单测不在 `pnpm gate` 里（门禁机器没有 Rust 工具链），走 `pnpm check:desktop`——碰了 `packages/desktop/**` 必跑，见 §5.6。

### 4.7 navigate：显示主窗口并跳到指定页

`navigate` 是唯一带参数的动作，配置形如 `{ "shortcut": "Ctrl+Alt+T", "action": "navigate", "target": "/todo" }`。配置文件这一层天然装得下：`HotkeyAction` 是内部标签枚举、`HotkeyBinding` 用 `#[serde(flatten)]`，带载荷的变体直接落位。

`target` 的取值来自 client 的主导航表 `MAIN_NAV_ITEMS`（八项，不含搜索页）。

**校验分工**：Rust 只管结构完整——`navigate` 必须带非空 `target`，否则那条绑定在 `parse_config` 就被跳过。**serde 只挡得住 `target` 缺失**（反序列化失败），空串是合法 `String`、会一路通过，因此空串要显式过滤。**页面清单只存在于前端一处**，由 `resolveNavigateTarget` 查 `isMainNavRoute` 裁定；Rust 对有哪些页面零知识。这样不产生第二个跨语言重复点，也就不欠第二道闸；代价是无效 target 会一路注册成功、到前端才被丢弃——那条路径上有回显（设置页红字），不是静默。

**四种窗口状态**：隐藏 / 最小化 → `show_main_window` 拉出来并跳；开着但在别的页 → 跳过去；开着且已在目标页 → 什么都不干；目标页有未保存修改 → `useUnsavedChangesGuard` 照常拦（跳转走 router，`useBlocker` 管得到）。「已在目标页」判的是 **pathname**，`/?date=…` 按「跳时间轴」也算已经在那页。

同页不跳不只是行为取舍：`navigate()` 到当前路径会往 history 压一条重复条目，压多了返回键要按很多次才退得出去。

`navigate` 不进桥的串行队列（§4.4）——它不写库、无顺序依赖，排在正在跑的 punch 后面只会让跳转莫名延迟。

**投递载荷的构造在 `hotkeys.rs::hotkey_payload`，不在 `commands.rs`。** 抽出来是为了立闸：`handle_hotkey` 要 `AppHandle`、单测够不着它，内联在那里时把 target 恒置 `None` 不会让任何测试变红，而热键的可观察结果是零（前端拿不到 target 就丢弃）。两条单测分别锁住「navigate 必须带上目标页」与「其余动作一律不带」。

### 4.8 已知界限：存量绑定会被上游变更抹掉

两条同构、都静默：

1. **删掉一个动作变体**会抹掉用户已配的该动作绑定。三个写命令都是 load→改→**全量覆盖**写回；变体一删，存量条目在 `parse_config` 的 `filter_map` 处被跳过，此后任何一次保存就把它永久抹掉——无提示、零测试红。**做删除时必须显式处理存量绑定**（读时迁移剥离 / 保留变体空转 / 删除时通知用户），不能只删变体。反向的「保留变体、只删窗口」同样静默：`target_window` 仍返回那个 label，每次按键往一条没有窗口的队列里塞。
2. **改路由名**会让 `navigate` 的存量 `target` 失效，表现是按下没反应。这一条有回显——设置页在该行标红字「目标页「…」不存在，重新选一个」。

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

「按下热键 → 浮窗拿到键盘焦点」这条在 Windows 上**不是必然的**：前台锁会把 `set_focus` 降级成任务栏闪烁（§4.3 的确认卡撞过同一件事）。实现是直白的 `show` + `set_focus`，能不能真拿到焦点由系统裁决，三种场景各不相同：别的应用正在接收键盘输入、别的应用全屏、短时间内连续唤起。

**这条路径上没有兜底**：`show_capture_window` 是无条件的 `show` + `unminimize` + `set_focus`，三句的失败都被 `let _ =` 吞掉，既不检查焦点最终落在谁身上，也不发通知。抢不到焦点时浮窗照显，成为「看着能打字、键入却进了别的应用」的半开状态，屏幕上零提示。

补兜底时的判据是**宁可不显示窗口 + 发通知，也不留半开状态**——半开比不出现更糟。

### 5.6 三道闸各守什么

| 闸 | 守什么 | 何时跑 |
|---|---|---|
| `check-desktop-config.mjs` | 两个窗口按 label 的属性快照、跨语言事件名全匹配、禁静态 import Tauri（§8）、capabilities 授权列表 == `tauri.conf.json` 的窗口集合 | `pnpm --filter @timedata/desktop test` |
| `check-hotkey-actions.mjs` | 动作名在**四处**一致：Rust `action_id` / `api.ts` 联合类型 / 设置页 `ACTION_OPTIONS` / 消费分支 | 同上 |
| `pnpm check:desktop` | 上面两道 + `cargo test` + `cargo clippy -D warnings` | 手动，碰了 `packages/desktop/**` 必跑 |

`check-hotkey-actions.mjs` 存在的理由：设置页的 `ACTION_OPTIONS` 漏一个动作时**没有任何测试会红**，但用户在「桌面设置」里根本选不到那个动作——热键配不上。

消费分支那一条守的是：凡是 `target_window` 返回 `Some` 的动作，必须在**对应窗口**的消费文件里有一处 `event.action === "<id>"`；返回 `None` 的必须一处都没有。不这样守的话，加动作时把三处声明点改全、漏掉消费分支 → 设置页选得到、热键注册成功、按下去零反应，而编译、全部测试、两道闸全绿。按窗口精确匹配而不是扫两个文件的并集，是因为并集守不住「写错窗口」——把 navigate 的处理写进 `CaptureApp` 照样绿，而那条分支永远触发不到。

capabilities 那一条守的是另一个同形的洞：新增窗口时 `tauri.conf.json` 加了 label 却漏了 `capabilities/default.json` 的 `windows` 列表，该窗口的 WebView 拿不到任何 IPC 权限——构建、测试、其余断言全绿，装机后那个窗口一片空白。

## 6. 构建与发布

`windows` job 跑在 `windows-latest` runner 上，与 `android` / `ios` 同为 `needs: prepare` 的平台 job，先到先上架。`workflow_dispatch` 的 `platform` 选项含 `windows`，`both` 含全部三个平台。**`push` 触发不区分平台**：`mobile-release` 的 push paths 是三个壳共用的一大串（`packages/{client,mobile,desktop,shared}/**`、根 `package.json` / lockfile / workspace / tsconfig、各版本与图标脚本、workflow 自身），且 push 时 `inputs.platform` 为空串、`prepare` 显式把它当 `both`——**改 client 或 shared 照样会跑 Windows job**，不是只有 `packages/desktop/**` 与 `scripts/desktop-version.mjs` 两条路径才触发。想让 Windows 只随 desktop 变更发布，得改 workflow 的 paths 或 prepare 判定，光改文档不解决。

版本号有一道转换：发布链路的版本码是 8 位数字 `YYMMDDNN`，Tauri 的 `version` 必须是合法 semver。`scripts/desktop-version.mjs` 的 `codeToSemver` 把它转成 `YY.MMDD.NN`（各段去前导零，`26080301` → `26.803.1`），三级都单调递增。转换结果经 `tauri build --config` 注入，`tauri.conf.json` 里的 `version` 字段不参与发布。

产物是 NSIS 安装包，`bundle.targets` 恰好为 `["nsis"]`。bundler 输出名带版本号，发布前统一改名为 `TimeData-Setup.exe`。安装包不做代码签名，SmartScreen 会拦一次。安装位置是 `%LOCALAPPDATA%\TimeData`，开始菜单快捷方式为 `TimeData.lnk`。

`windows` job 不执行 `gh release edit --latest`——latest 归属规则见 [deployment/ios-ipa](ios-ipa.md#deployment-ios-ipa-s4)。

## 7. 数据边界

Tauri 用独立的 WebView2 用户数据目录，与 Edge / Chrome 的 profile 不互通。桌面壳因此是本机上又一份独立的 IndexedDB，与浏览器里访问同一站点的数据互不可见，两者只能通过服务器同步汇合——与 Capacitor 壳和 PWA 的关系同构（见 [deployment/ios-ipa](ios-ipa.md#deployment-ios-ipa-s5)）。首次启动是空数据，需在设置里填 API 地址与 Token。

同一个 Tauri 应用内的多个窗口共享同一个 WebView2 用户数据目录，因此共用同一份 IndexedDB。

## 8. 配置闸

`packages/desktop/scripts/check-desktop-config.mjs` 随 `pnpm --filter @timedata/desktop test` 运行，守三类「配错了没有任何其他门禁会红」的约定：

1. **`tauri.conf.json` 快照**：`frontendDist` 为 `../../client/dist`、两个 before 命令都调 `build:mobile`、`identifier` 为 `icu.yanzhou.timedata`、`bundle.targets` 恰好 `["nsis"]`。窗口按 **label** 取（不按数组下标），主窗口 `visible` 为 `true`，浮窗的 `url` 与 `visible` / `decorations` / `skipTaskbar` / `alwaysOnTop` / `resizable` 五项逐一断言——浮窗少一项 `decorations: false` 就是一个带标题栏的窗口，少一项 `skipTaskbar` 就多一个任务栏图标，都不会让任何测试变红。这些字段配错时构建不一定报错，产出的却是空壳、旧产物或注册了 service worker 的包。
2. **跨语言事件名（全匹配）**：`hotkeys.rs` 必须声明 `pub const HOTKEY_EVENT: &str = "…";`；`src-tauri/src/` 下**任何 `.rs` 里一处裸字面量 emit 都不许有**（正则覆盖 `emit` / `emit_to` / `emit_filter` 三种形态，集合必须为空——只认 `app.emit(` 的话，改用 `emit_to` 点名投递的那条路径会整个绕开闸）；`api.ts` 里 `listen<…>("…")` 的名字集合必须恰好等于那个常量的值。闸不能写成「文件里出现过一次」——`commands.rs` 有两处 emit（实时投递、就绪后补投），那种写法在改名时只改到第一处就照绿：日常按键正常，唯独「WebView 就绪前排队的那批」发的是旧名字、前端永远收不到，正好打掉 §4.2 承诺的「开机第一秒按下也生效」。两端之间没有共享类型，typecheck 管不到字符串字面量。
3. **禁静态 import Tauri API**：扫 `packages/client/src/**/*.{ts,tsx}`，任何 `from "@tauri-apps/api…"` / `import "@tauri-apps/api…"` 形态（含 type-only 与单引号）都报红，只准 `await import(...)`。这是三端 bundle 不加载 Tauri 运行时的唯一保证。需要类型就在 `lib/desktop/api.ts` 里自己声明。

## 9. 排错

- **开机自启指向了旧路径**：标记文件与启动项不同步。删除 `%APPDATA%\icu.yanzhou.timedata\autostart-initialized` 后重新运行一次即可重建。
- **在任务管理器里关了自启，下次启动又回来了**：这是 §3 的判定语义。持久关闭的路径只有一条——应用的「设置 → 桌面设置」，它会把意图记进 `desktop-config.json`。
- **窗口关不掉 / 关了进程还在**：这是设计语义（§2），托盘菜单「退出」才是唯一退出口。
- **热键没反应**：先看「设置 → 桌面设置」里该行有没有红字——有则组合被别的软件占用（换一个）；再看有没有「改动要保存才生效」——**改了 / 删了行不点保存是不生效的**，壳里注册着的仍是上次保存的那张表，而且再聚焦任意录入框会按磁盘配置重新注册、把「删掉」的那条装回来；都没有则检查是不是按了裸字母 / 数字（录入框会就地回显「要带 Ctrl / Alt / Shift」）。
- **按了跳转键没反应**：先看「设置 → 桌面设置」那一行有没有红字——有则目标页已失效（多半是路由改过名），重选一个。都没有则看主窗口是不是已经停在那一页了：同页再按是刻意不做任何事的（§4.7）。
- **在 `?date=` 翻过页的时间轴上按「跳时间轴」没反应**：判据是 pathname，`?date=` 不算另一页。要回今天走时间轴页自己的入口。
- **改了打点确认阈值好像没生效**：填了 0 / 负数 / 非数字时不保存，输入框会自动改回上次存住的值并给出提示。看到「已改回 X」就说明这次没存上。
- **按了打点却弹出确认卡**：不是故障，是同步没拉完时的防打歪，见 §4.3。
- **热键连按几下只记了一条**：不是故障，是桥的串行队列，见 §4.4。
- **`tauri dev` 下打点没有系统通知**：dev 运行的 exe 没有带 AppUserModelID 的开始菜单快捷方式，Windows 会丢掉这条 toast。通知行为以 NSIS 装机版本为准。
- **开始菜单里看不到条目**：快捷方式在 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\TimeData.lnk`，Windows 开始菜单列表存在索引延迟，搜索能直接命中。
- **NSIS 打包步骤找不到产物**：`bundle.targets` 被改动时 bundler 会产出到别的子目录，`Rename installer` 步骤据 `*-setup.exe` 匹配。
- **桌面版看不到浏览器里记的数据**：不是故障，见 §7。
