---
type: evergreen
title: Windows 桌面壳 · 全局热键与打点
covers:
contracts:
  - packages/desktop/src-tauri/src/config.rs
  - packages/desktop/src-tauri/src/hotkeys.rs
  - packages/desktop/src-tauri/src/commands.rs
  - packages/client/src/lib/desktop/desktopPunch.ts
  - packages/client/src/lib/desktop/navigateAction.ts
last-reviewed: 2026-08-13
---

# Windows 桌面壳 · 全局热键与打点

> [desktop](../desktop.md) 的**热键子文档**：桌面壳配置文件、热键注册与分发、打点全程与确认卡、桥的串行队列、navigate 动作，以及两条已知界限。
> 讲什么：`desktop-config.json` 的字段与三态读、两把锁的分工与锁序、punch 的四条出口、串行队列的身份比对、navigate 的校验分工。
> 不讲什么：壳的构成与窗口/托盘语义、开机自启、速记浮窗与双窗口、配置闸、构建发布（都在 [母文档](../desktop.md)）。

## 承上启下

- **上游**：[母文档](../desktop.md) §1 的 Tauri 壳与 `shell.rs` 纯函数层；Windows 全局热键 API。
- **下游**：[timeline](../timeline.md) 的 `punchNow`（热键打点复用它写库）、[categories-settings/settings-catalog](../categories-settings/settings-catalog.md) 的打点分类设置 key。
- **契约**：Rust 是 `desktop-config.json` 的唯一写者；事件名 `desktop-hotkey` 只准出自 `hotkeys.rs` 的常量；`desktopPunch` 是桌面打点的唯一写入口并自守上限。
- **邻居**：[母文档](../desktop.md)、[android](../android.md) / [ios](../ios.md)（同一条发布 workflow 的另两个平台）。

## 1. 配置文件

`%APPDATA%\icu.yanzhou.timedata\desktop-config.json` 是桌面壳自己的配置文件，**Rust 是唯一写者**，前端读写全部走 IPC 命令。字段：

| 字段 | 语义 |
|---|---|
| `hotkeys` | `[{ shortcut, action }]`，出厂空数组（不带默认键位，装好后在设置页自己配） |
| `punchConfirmHours` | 打点确认阈值（小时），默认 4；非有限值或 `<= 0` 被拒 |
| `autostartDisabled` | 用户在设置页关过自启的意图记录，见 [母文档](../desktop.md) §3 |

`shortcut` 是 Tauri accelerator 字符串，修饰键顺序由前端 `normalizeShortcutFromKeyboardEvent` 钉死为 `Ctrl→Alt→Shift→Super`，与用户按下的先后无关——存进配置的串必须与回显注册结果时用来匹配的串逐字一致。字母 / 数字必须带修饰键（裸键会让正常打字触发全局动作），F1–F24 例外可裸录。`action` 是带参枚举，成员为 `punch` / `toggleMain` / `capture` / `navigate`。前三个无参；`navigate` 带一个 `target`（内部标签 + `#[serde(flatten)]` 让它直接落位，见 §7）。

**读配置分三态**：文件不存在 → 默认配置（首次启动的正常路径）；**读失败 → `Err`**；读到了 → 解析结果。读失败与文件不存在必须分开——杀软 / OneDrive / 备份工具短暂独占文件的那一瞬，若被当成「还没配过任何东西」，写命令就会拿全默认值（`hotkeys: []`、`autostartDisabled: false`）去做 load→改→**全量覆盖**写回，一次保存抹掉全部快捷键、把关掉的自启重新打开，还返回成功。因此：三个写命令拿到 `Err` 一律**拒绝保存**并把原因抛给前端；`resume_hotkeys` 拿到 `Err` **不碰注册表**（否则一次读不到就等于把当前活着的热键全注销）；启动路径拿到 `Err` 时既不动自启也不注册热键，改发一条系统通知说明本次启动什么都没做（重启即恢复，比上面两件都轻）。

解析两层容错：整个文件坏掉视为默认空配置，不崩溃；单条 `hotkeys` 里认不出的动作跳过、其余照用。**「坏文件在下次保存时被整体覆盖」说的是解析失败（内容真坏了），与上面的读失败不是一回事。**认不出的条目的前向兼容只在**读**路径成立：旧版本的任何一次保存都是全量覆盖，跳过的条目就此永久消失——这是当前接受的行为（Rust 是唯一写者，跨版本回退属罕见操作），`config.rs` 有一条用例把它明写在纸面上。

落盘走原子写（临时文件 + rename），中途断电不会留下半截 JSON。所有 `load → 改 → save` 形态的 IPC 命令先拿同一把进程内写锁，否则两条并发写命令会交错成「各自基于旧文件改、后写者静默抹掉先写者」。**锁与它保护的资源同在 `config.rs`**：纯读改写走 `update_config`（调用方不必记得拿锁），需要在锁内多做一件事的（`set_hotkeys` 写盘后要注册热键、`set_autostart_enabled` 写盘前要开关系统自启）显式取 `config_write_guard`。字段定义与解析在 `packages/desktop/src-tauri/src/config.rs`。

`autostart-initialized` 标记文件与本文件职责不同（它记「上次注册自启时的 exe 路径」，见 [母文档](../desktop.md) §3），两者互不覆盖。

## 2. 注册、分发与排队

- 壳启动读配置即注册热键，**不等 WebView**——开机第一秒按下就有效。启动时的注册失败无处回显（窗口可能还没起来），设置页打开时会通过 `resume_hotkeys` 重新注册并重报结果。
- 设置页保存 → Rust 先 `unregister_all` 再按新表逐条注册 → 返回 `[{ shortcut, action, ok, error }]`。单条失败（组合被别的软件占用、格式非法）不影响其余条目，失败原因在设置页对应行以红字回显。
- 按下时 Rust 记录**按键时刻**（epoch ms）后按动作分流：`toggleMain` 由 Rust 直接办（`resolve_toggle_action`：可见、未最小化且**在前台**才 hide，其余一律 show + unminimize + focus——「可见但被别的窗口盖住」按热键是想见到它），不进 WebView，页面卡死也好使；`punch` 带 `{ action, pressedAtMs }` 投递进主窗口 WebView。
- 「在前台」的合成与 toggle 判定一起收在 `shell::resolve_toggle_from_window` 里，`commands.rs` 只负责取六个原始值（可见 / 最小化 / `is_focused()` / 前台原始句柄 / 归一后的句柄 / 本窗口句柄）、一句判断都不做——归一那步留在装配层时没有任何测试锁得住它。判定本身**两路取或**：tao 的 `is_focused()`，或 Win32 `GetForegroundWindow()` 经 `GetAncestor(GA_ROOT)` 归一后等于本窗口 HWND。只信前者不够——WebView2 子窗口吃走键盘焦点后，它在窗口明明处于最前时报 false，toggleMain 于是每次都走 show、**再也收不起来**。归一那步不能省：前台往往正是本应用自己的 WebView2 子窗口。两路取或而非只留 Win32 一路，方向是「宁可收起」：误判 hide 多按一次就自愈，误判 show 是按多少次都出不来的死局。句柄 0（无前台窗口 / `hwnd()` 取不到）不参与相等比较，否则「两边都拿不到」会被当成「前台就是我」。这六个值**各有自己的 newtype**（`Visible` / `Minimized` / `ForegroundRaw` / `AncestorRoot` / `SelfHwnd`），在取值那一处就套上、不在调用处现包：相邻同类型参数写反是真值表锁不到的一类错——两个句柄对调的效果恰是「拿未归一的原始句柄去比」，套上之后它是编译错误。
- **热键注册表另有一把锁**，与配置文件写锁分开：注册表有三个写者（`set_hotkeys` / `suspend_hotkeys` / `resume_hotkeys`），而只护配置文件不够——点一次「保存快捷键」这个动作本身就会先 blur 录入框发出 `resume_hotkeys`、再发出 `set_hotkeys`，两条 promise 互不等待。交错时 `resume` 的 `unregister_all` 会落在 `set_hotkeys` 注册完之后，抹掉新表装回旧表：文件里是新表、页面显示全绿、系统里跑的是旧表。碰注册表的函数收 `RegistryGuard` 引用，**漏拿锁编译不过**。前端把录入态的 `suspend` / `resume` 串成一条链是必要配套，但不充分。
- **拿到锁只是一半：`resume_hotkeys` 的读也必须在注册表锁内。**互斥只保证两条命令不交错，**不保证顺序**——`resume_hotkeys` 若在锁外先 `load_config`，读到的可能是 `set_hotkeys` 落盘前的旧表；等它排到锁，`set_hotkeys` 早已写完文件、装好新表并全部释放，`resume` 这才按旧表 `unregister_all` 加重注册，把上面那个终态原样复现一遍。所以它**先 `lock_registry()` 再 `load_config`**，这两句的顺序不能倒。
    另两个写者各是各的形状，不存在「三个写者同一条锁序」这回事：`suspend_hotkeys` 只拿注册表锁注销，根本不读配置；`set_hotkeys` 在**配置写锁**内走 load→改→全量写回，之后才拿注册表锁按刚落盘的新表重注册——它装的就是自己刚写的那份，不存在读到旧表的窗口。`RegistryGuard` 拦得住「漏拿锁」，拦不住「在锁外先读」——后者没有编译期或测试期的闸，只有这一条与 `resume_hotkeys` 上的注释记着。锁内读不会死锁：`load_config` 只读文件、不碰配置写锁，两把锁之间无环。`main.rs` 的 `setup` 同样是配置在上、锁在下，但它跑在事件循环启动之前，三个写注册表的命令此刻一条都派发不出来，别把这个顺序照搬进命令里。
- 事件名 `desktop-hotkey` 是 Rust `emit` 与前端 `listen` 之间唯一的约定。**Rust 侧的字面量只准出现在 `hotkeys.rs` 的 `HOTKEY_EVENT` 常量里**（`commands.rs` 有两处 emit，各写一遍字面量时改名极易漏掉补投那处），由配置闸全匹配比对（见 [母文档](../desktop.md) §7）。
- WebView 未就绪时 punch 事件在 Rust 侧 **FIFO 排队**；前端桥挂好监听后 `invoke("desktop_ready")`，Rust 收到即按序补投。`pressedAtMs` 随事件走，因此**执行晚了不影响封口时刻**——开机第一秒按打点，记录的就是那一秒。`toggleMain` 不排队。
- **队列按 label 分组，每组有水位上限，溢出丢最老的**。两个窗口各有各的就绪时刻，共用一个 ready 标志会让先起来的那个替另一个宣布就绪。上限管的是「某个 label 的 WebView 永不就绪」——那种情况下队列会随每次按键无限长，就绪后再一次性突发冲刷；丢最老是因为积压到溢出时，最早那些按键早已失去时效，而最新按下的那次最可能仍是用户想要的。
- 设置页的快捷键录入框进入录入态时先 `suspend_hotkeys`（注销全部），失焦 / 录完再 `resume_hotkeys`。不挂起的话，录一个本应用已注册的组合时按键会被全局热键吃掉、永远录不上；挂起后不恢复则按一次 Esc 全局热键就永久失效。

## 3. punch 全程

按键时刻先向下取整到分钟（与 `punchNow` 一致），然后**先看再写**：查最后一条记录 → `resolvePunchRange` 算区间 → 校验打点分类 → 比阈值。四条出口：

| 情形 | 结果 |
|---|---|
| 区间为 null | 不写。系统通知「距上次记录还没有时间」**+ 窗口内提示条**，并清掉停留中的确认卡 |
| 打点分类缺失 / 已归档 | 不写。系统通知「请先在设置里选择打点分类」**+ `show_main` + 窗口内提示条**，并清掉停留中的确认卡 |
| 区间时长 > `punchConfirmHours` | 不写，`show_main` 提起主窗口 + 一条通知，显示确认卡「要把 HH:mm–HH:mm 记为打点吗？」[记录 / 算了] |
| 阈值内 | 调 `punchNow(pressedAt)` 写入，系统通知「已打点 HH:mm–HH:mm」+ 主窗口挂撤销条 |

**每条出口都要有一个不经通知通道的落点**：系统通知两端各吞一次（Rust 的 `let _ = …show()`、桥的 `quietly`），专注助手开着或通知权限关了就是屏幕上零变化。只有通知的话，全新装机必然撞上的那条（[母文档](../desktop.md) §6 首次启动是空数据 → 没配打点分类 → 按热键走第二条）就是不写库、不提窗、无红字，用户会去查热键注册（设置页全绿），真正的原因被静默丢掉。`needsConfirm` 也发通知：Windows 的前台锁会把 `set_focus` 降级成任务栏闪烁，只靠 `show_main` 时这次按键可以是零可观察结果。队列里抛出的失败同样两条路都给（提示条 + 通知），原因文本用 `messageOf` 读——**Tauri 的 invoke 失败 reject 的是字符串**（Rust 的 `Err(String)`），只认 `Error` 的写法会把 Rust 写的原因换成一句无信息的兜底词。

「不写」的两条出口清掉停留中的确认卡：卡上的区间是按下那一刻算的，走到这两条说明当下数据已经不支持它了，留着就是「通知说没时间可记、屏幕上却挂着一张要你记 00:00–12:00 的卡」。

确认卡是防打歪的守门员：同步还没拉完时，「上一条记录」可能是几小时前的，直接落笔就是一整段假记录。`desktopPunch(pressedAtMs, maxHours)` 是唯一写入口，**自己守上限**——阈值判定写成否定式 `!(rangeHours(range) <= maxHours)`，`maxHours` 为 `NaN` 或区间含非法 ISO 时倒向弹卡而不是静默放行。

**确认卡上点「记录」后可能再弹一次卡**（副文案变成「刚才那条记录已不在了，区间比你看到的更长」），这不是故障：重试时按当下数据重算，上限用的是**用户批准的那个长度**（`rangeHours(用户看到的区间)`）而不是配置阈值。区间变短直接写（更准），变长则再问一次——同步会传播删除，「重算只会更准」并不成立。

确认卡弹出时**焦点直接落在「记录」上，Esc = 算了**：用户刚按完热键、手还在键盘上，焦点不进卡片就只剩鼠标一条路。

**撤销条**不自动消失（窗口可能整段隐藏，打开时要还在），到下一次热键打点 / 确认操作时被替换，可手动关。撤销 = 删该条记录，与圆环打点撤销同路。页内既有 toast（时间轴页 / 速记页的 `handlePunch`）不动、并存。

系统通知经 notification 插件发，**纯文字**：Windows 桌面端的通知放不了按钮，也拿不到点击回调（底层 `notify-rust` 的 action API 只支持 XDG/Linux）。通知只「告知」，一切可交互的东西都在主窗口。

## 4. 桥的串行队列

`DesktopBridge` 把全部状态转移排成**一条串行队列**（`queueRef` 链式 `.then`，状态从 `stateRef` 读而非渲染时捕获的 state）。热键连按两下会并发跑两次打点，各自约 8 个 `await` 必然交错：两次都在对方写库前读到同一条「上一条记录」、算出同一区间，于是各写一条**完全重叠**的假记录（`punchNow` 的 `overlapPlan` 为 null，不裁剪）。串行化后第二次看得见第一次写下的记录，正确地报「距上次记录还没有时间」——**连按只落一条是设计结果**。队列的 `catch` 在 `.then` 回调内部——漏在外面时一次 reject 会截断整条链，此后每次打点都静音且无报错。

**用户动作进队列时要带身份**：他点下去那一刻屏幕上的那张卡 / 那条撤销条本身（对象引用），执行时比对不上就原样返回。一次打点在队列里要跑几十~几百毫秒，这个窗口里点「撤销」的话，队列会先跑完新打点、把撤销条换成新写的那条，再轮到这一下——删掉的是新的、不是他看着的那条；「✕」「算了」同形状。身份**用对象引用而不是 `entryId` / `pressedAtMs` 这类字段值**：确认卡重试时新卡的 `pressedAtMs` 与原卡相同（同一次按键），字段比对会放行「双击『记录』」，第二下按新卡那个更长的已批准长度落笔——正是 §3 那条 Critical 的失败形态。

**提示条是唯一的例外，身份按文案比。**它只有 `message` 一个字段、屏幕上长什么样完全由它决定，而三个生产者（`noRange` / `missingCategory` / 队列 `catch`）每次都现造新对象：文案相同的两条对用户完全无从分辨，引用比对在那里退化成「点了 ✕ 没反应」——屏幕上文字前后一个字不差。比对放在消费端（`dismissNotice`）而不是让生产者「文案没变时沿用原对象」：后者要三处各自记得，漏一处就复现同一个症状且不会红。撤销条与确认卡不适用：它们身份一变文案必变，用户看得出换了一条。

## 5. 已知界限：区间判定与落笔不在同一个事务里

区间判定与最终落笔跨**多个独立的 IndexedDB 事务**——`desktopPunch` 的预检读一次、分类校验读三次、`punchNow` 内部重算又读一次。中间约 1–5ms 的窗口里，若同步的 rw 事务恰好删掉锚定区间起点的那条记录，`punchNow` 重算出的区间会比预检时更长，**落笔区间可能超过用户已批准的长度**。这是已知并接受的窗口，不是待发现的 bug。

两条局部闭合路都拿必现风险换极小概率风险，因此都没有采用：给 `punchNow` 加区间下界参数会把桌面策略渗进它的两个既有调用方（时间轴页 / 速记页共用）；把 `desktopPunch` 整体包进一个 Dexie 事务会引入事务 scope 枚举错误与 `await` 逃出 Dexie zone 这类新失败模式，写错就是 100% 的正常打点坏掉。真正的闭合在 `punch.ts` 一侧：把「读锚点 + 写打点」合成一次权威读的原子操作。

相邻的一件事：`desktopPunch` 的区间推导是 `punchNow` 那四行的**复刻**（预检要在不写库的前提下先算出区间给用户看）。分叉的后果不是「算错」，而是守门员守错了对象——卡上给用户看的区间、以及自守闸比对的，都是旧规则算的，落笔的却是新规则算的。两侧各有互指注释，`desktopPunch.test.ts` 有一条跨文件一致性用例（同一份库状态下两处算出的区间必须逐字相同），分叉时它会红。

## 6. 模块速查

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

Rust 单测不在 `pnpm gate` 里（门禁机器没有 Rust 工具链），走 `pnpm check:desktop`——碰了 `packages/desktop/**` 必跑，见 [母文档](../desktop.md) §5.6。

## 7. navigate：显示主窗口并跳到指定页

`navigate` 是唯一带参数的动作，配置形如 `{ "shortcut": "Ctrl+Alt+T", "action": "navigate", "target": "/todo" }`。配置文件这一层天然装得下：`HotkeyAction` 是内部标签枚举、`HotkeyBinding` 用 `#[serde(flatten)]`，带载荷的变体直接落位。

`target` 的取值来自 client 的主导航表 `MAIN_NAV_ITEMS`（八项，不含搜索页）。

**校验分工**：Rust 只管结构完整——`navigate` 必须带非空 `target`，否则整条绑定被跳过。判据收在 `config.rs::binding_is_structurally_valid` 一处，**读写两路都过**：`parse_config` 挡手改配置文件写进来的坏条目，`replace_hotkeys` 挡不经设置页 UI 的写入。只在读路径过滤是不够的——空 target 绑定会「注册成功 → 按下去零反应 → 下次读配置整条凭空消失」。**serde 只挡得住 `target` 缺失**（反序列化失败）；空串与只有空白的串都是合法 `String`，要显式 `trim` 后判空。**页面清单只存在于前端一处**，由 `resolveNavigateTarget` 查 `isMainNavRoute` 裁定；Rust 对有哪些页面零知识。这样不产生第二个跨语言重复点，也就不欠第二道闸；代价是无效 target 会一路注册成功、到前端才被丢弃——那条路径上有回显（设置页红字），不是静默。

**四种窗口状态**：隐藏 / 最小化 → `show_main_window` 拉出来并跳；开着但在别的页 → 跳过去；开着且已在目标页 → **不发生页面跳转**——但 `handle_hotkey` 对 `navigate` 无条件先调 `show_main_window`（拉出 + 取消最小化 + 聚焦），窗口该拉还是会拉：最小化 / 被别的应用盖住时按同页 navigate，窗口会到前台，「什么都不干」只指前端那一跳没发生；目标页有未保存修改 → `useUnsavedChangesGuard` 照常拦（跳转走 router，`useBlocker` 管得到）。「已在目标页」判的是 **pathname**，`/?date=…` 按「跳时间轴」也算已经在那页。

同页不跳不只是行为取舍：`navigate()` 到当前路径会往 history 压一条重复条目，压多了返回键要按很多次才退得出去。

`navigate` 不进桥的串行队列（§4）——它不写库、无顺序依赖，排在正在跑的 punch 后面只会让跳转莫名延迟。

**投递载荷的构造在 `hotkeys.rs::hotkey_payload`，不在 `commands.rs`。** 抽出来是为了立闸：`handle_hotkey` 要 `AppHandle`、单测够不着它，内联在那里时把 target 恒置 `None` 不会让任何测试变红，而热键的可观察结果是零（前端拿不到 target 就丢弃）。三条单测分别锁住「navigate 必须带上目标页」「其余动作一律不带」，以及**载荷 JSON 里根本没有 `target` 键**——`Option` 不加 `skip_serializing_if` 会序列化成 `"target": null` 且键恒在，而前端类型声明的是 `target?: string`，按 `=== undefined` 判「没带」就会全部落空。

## 8. 已知界限：存量绑定会被上游变更抹掉

两条同构、都静默：

1. **删掉一个动作变体**会抹掉用户已配的该动作绑定。三个写命令都是 load→改→**全量覆盖**写回；变体一删，存量条目在 `parse_config` 的 `filter_map` 处被跳过，此后任何一次保存就把它永久抹掉——无提示、零测试红。**做删除时必须显式处理存量绑定**（读时迁移剥离 / 保留变体空转 / 删除时通知用户），不能只删变体。反向的「保留变体、只删窗口」同样静默：`target_window` 仍返回那个 label，每次按键往一条没有窗口的队列里塞。
2. **改路由名**会让 `navigate` 的存量 `target` 失效。主窗口开着时表现是按下没反应；**隐藏 / 最小化时窗口仍会被拉出来、页面停在原处**（`show_main_window` 无条件先执行，见 §7）。这一条有回显——设置页在该行标红字「目标页「…」不存在，重新选一个」。
