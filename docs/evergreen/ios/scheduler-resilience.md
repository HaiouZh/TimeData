---
type: evergreen
title: iOS 壳 · 调度器韧性
covers:
  - packages/client/src/components/SchedulerWatchdog.tsx
  - packages/client/src/lib/schedulerHostGuard.ts
  - packages/client/src/lib/recovery/schedulerProbeReport.ts
  - packages/client/src/lib/recovery/mainThreadHeartbeat.ts
  - packages/client/src/lib/recovery/storageProbe.ts
  - packages/client/src/lib/recovery/reactRootProbe.ts
  - packages/client/src/lib/recovery/lazyRegistry.ts
  - packages/client/src/lib/recovery/storageTiming.ts
  - packages/client/src/lib/recovery/reportId.ts
  - packages/client/src/lib/recovery/openSession.ts
  - packages/client/src/lib/recovery/openSessionRuntime.ts
  - packages/client/src/lib/recovery/lastHidden.ts
  - packages/client/src/hooks/useAppHidden.ts
contracts:
  - packages/client/src/lib/schedulerHostGuard.ts
  - packages/client/src/lib/recovery/reactRootProbe.ts
  - packages/client/src/lib/recovery/openSession.ts
last-reviewed: 2026-09-16
---

# iOS 壳 · 调度器韧性

> [ios](../ios.md) 的**子文档**：React 调度器为何会在 iOS 上永久停摆、怎么判定、怎么救回来。
> 不讲：iOS 保留路由栈与边缘返回手势（见 [page-stack](page-stack.md)）、原生工程构建链路（见 [母文档](../ios.md) §2）。

## 承上启下

- **上游**：App 被系统挂起（息屏 / 切后台）后恢复。
- **下游**：所有经 React 调度器提交的更新——路由导航、`useLiveQuery` 回流、`startTransition` 包裹的一切。
- **契约**：`installSchedulerPortTap()` 须在**调度器首次排队之前**装上（`main.tsx` 模块体里、`createRoot().render()` 之前）；补拍机制押在「调度器以 `postMessage(null)` 排队」这一形态上。
- **邻居**：[ios](../ios.md)（母文档）、[categories-settings/settings-catalog](../categories-settings/settings-catalog.md)（首帧回退的另一处 iOS 可见症状）。

## 1. 死锁怎么形成

React 的调度器（`scheduler` 包）在浏览器里靠一条 `MessageChannel` 给自己排队干活：`port2.postMessage(null)` 发出，`port1.onmessage` 收到后才开工。其内部有个「消息循环已在跑」的开关，**只有那条消息真的送达并处理完才复位**，而排队入口对该开关有守卫——是 true 就不再发新消息。

WKWebView 在 App 被挂起时会把在途消息直接丢掉。消息一丢，开关永久停在 true，之后每一次排队请求都被守卫跳过，调度器再也不会开工。安卓的 Chromium WebView 不丢这条消息，故此症状是 iOS 独有（iOS Safari 的 PWA 同属 WebKit，一样会中）。

## 2. 现场为什么是「半瘫」而不是「全死」

React 按 lane 决定更新走哪条通道，两条通道在死锁后的存活状态是分开的：

| 更新来源 | 通道 | 死锁后 |
|---|---|---|
| 点击 / 输入等离散事件里直接 `setState` | 微任务（`queueMicrotask`） | 照常生效 |
| `startTransition` 包裹的更新（react-router 的导航即在此列） | 调度器 | 停摆 |
| 异步回调里的 `setState`（Dexie `useLiveQuery` 回流） | 调度器 | 停摆 |

所以现场表现是「弹层点得开、日期选择器拉得出，但底栏 tab 点不动、打点写进库了画面不刷」。**这个组合本身就是判据**：全都点不动是别的毛病（例如保留层的 `inert` 盖在屏上，见 [page-stack](page-stack.md)），只有走调度器的那半停摆才是本条。

## 3. 怎么救：补一拍

`performWorkUntilDeadline` 只要被调用一次，就会把积压干完，并在无更多工作时把开关复位，整套调度随之复活。所以解法是把丢掉的那条消息重发一遍。

补发是安全的：该函数首行就是「开关没开就什么都不做」，任务队列本身也幂等，多进入一次至多空转。

难点只在**拿到那个端口**——它活在 `scheduler` 的模块闭包里，外部够不着。`lib/schedulerHostGuard.ts` 因此在 `MessagePort.prototype.postMessage` 上挂钩，把最近一次以 `null` 排队的端口记下来；`kickScheduler()` 就是给它补发一拍。

- **钩原型，不包装 `MessageChannel` 构造器**。包装构造器只对**之后**新建的 channel 有效，而 `scheduler` 在自己被求值时（模块顶层）就把 channel 建好了；生产构建里 React 被拆进独立 chunk 并被入口 chunk 静态 import，按 ESM 语义它必然先求值——任何写在应用侧模块体里的构造器包装都赶不上，**且不会有任何报错**。钩原型与时机无关：`postMessage` 是每次排队都要走的原型方法，只需在死锁发生前装上。
- **只认 `postMessage(null)` 这一形态**。不过滤就会把页面里别的 MessageChannel 使用方（workbox 等）记进来，补拍补到无关端口上——调度器依旧卡死，而我们以为已经救过了。这个前提由测试直接读 `scheduler` 产物钉住，React 升级改了调用形态会红。
- 挂钩不改变任何投递行为，开销是每次 `postMessage` 多一次比较和一次赋值。

> **补拍只治「消息没送回来」这一支。** 若现场判定是「送到了、React 自己挂着等一个永不 settle 的 transition」，补多少拍都没用——`markRootUpdated` 会在下一次非 Idle 更新时清掉 `suspendedLanes`，一个挂死的 transition 于是把后续同批 lane 一起拖住。分辨两支靠的是补拍后的送达账与根快照，见 §2.6；本节只写「怎么分辨」，不写「怎么治乙」。

## 4. 什么时候救：回前台探针

`components/SchedulerWatchdog.tsx` 每次回到前台发一枚探针：`startTransition` 里递增一个计数，超时窗口（`SCHEDULER_PROBE_TIMEOUT_MS`）内没落地就判定停摆，**先补一拍**；再过一个宽限窗口（`SCHEDULER_KICK_GRACE_MS`）仍没落地，才重载页面。

- **探针必须走 transition**：同步 `setState` 那条通道没坏，用它探不出任何问题。
- **「已落地」必须在渲染期同步记录**，不能写进 `useEffect`：effect 与提交同生共死，提交本身被卡住时 effect 根本不跑，那样探到的只是「effect 还跑不跑」，永远报死。
- **补拍优先于重载，判定三分**：补拍成功用户毫无感知，重载则丢掉滚动位置与未提交输入。超时那一刻先读端口在不在、真实等了多久，再补一拍——**不可见也照补、补不出去也不早退**（没发出去不代表调度器一定死了）；宽限结束那一刻再读可见性（提前采样会让中间切走的用户在后台被重载），按「落地了 → `recovered` 不重载 / 没落地且可见 → `reload` 留墓碑重载 / 没落地且不可见 → `held` 不重载、不封锁下次自救」三分。探针挂着期间再来的恢复事件只累加计数，**不重发探针、不重置定时器**——重置会把超时与宽限一并后推，真死锁时自救被无限推迟。
- **每次超时都记现场**：`scheduler_probe`（`lib/recovery/schedulerProbeReport.ts`）搭同步上报的车，字段与分辨表见 `docs_local` 里的观测口径 design §2.1 / §0.4。正常落地零上报；只有一个例外——探针落地了但定时器迟到 ≥ 2 个窗口记 `late`，那是「线程 / App 被冻、用户照样在等、看门狗却没动」唯一能被看见的地方。
- **两枚旁证探针只在看门狗挂着的几秒内跑**：主线程心跳（`mainThreadHeartbeat.ts`，250ms 一拍，量最大迟到）与 IndexedDB 最小往返（`storageProbe.ts`）。心跳迟到 ≈ 等待时长 → 线程被冻，不是调度器的事；IndexedDB 判定时没回来（`storageMs` 为 null）→ 存储层被冻，抛错记 -1——两者在数据里分开，存储报错不能被读成存储被冻。
- **「没落地」还要再分一次叉**：只知道没落地，分不出是消息没送回来还是 React 自己在等。三路证据合起来判：`schedulerHostGuard` 记 port2→port1 的配对与最近收发时刻（`delivered` / `pendingMsgMs`），`reactRootProbe` 读 FiberRoot 的 lane 位（`rootPre` / `rootPost`），`lazyRegistry` 报在途的懒加载 chunk（`lazy`）。判定口径、证伪条件与报告脚本见 `docs_local` 的 ios-instant-open 阶段1 design §2.8。
- **补拍后再等 250ms 不动就直驱**：拿配对端口直接调那个处理函数（`driveSchedulerDirectly`），结果记 `direct`。补拍无效而直驱能救活，是「坏的是消息投递本身」的判决性证据；直驱只在补拍已经失效时才跑，不作为常规路径。
- **不按平台 gate**：正常平台永远不触发，成本只是每次恢复一枚定时器；而 iOS Safari 的 PWA 里 `Capacitor.getPlatform()` 返回 `web`，按平台 gate 反而漏掉真会中招的一档。
- 探针窗口取秒级而非更短：React 自己给 transition 的饥饿保护也在同一量级，正常情况早已自行收敛，还没落地的只可能是真停摆。重载保留当前 URL，路由自然回到原处；此刻页面本就冻着，没有能被打断的交互。

## 4.5 与「渲染进程被回收」的鉴别

回前台后整页重载有**两个**成因，症状高度相似而修法完全不同：

| | 调度器死锁（本文） | 渲染进程被回收 |
|---|---|---|
| 谁重载的 | `SchedulerWatchdog` 补拍无效后自己 `location.reload()` | iOS 杀掉 WKWebView 的 Web Content Process，Capacitor 基类检测到终止后 `reload()` |
| JS 还活着吗 | 活着（事件循环正常，只有走调度器的更新停摆） | 不在了，屏幕上是系统留的快照 |
| 现场表现 | **半瘫**：弹层点得开、底栏 tab 点不动 | **全死**：什么都点不动 |
| 冻多久 | 固定量级：探针窗口 + 补拍宽限 | 不固定，取决于重载与冷启动耗时 |
| 有启动画面吗 | 没有（app 进程一直活着） | 也没有（app 进程同样活着，死的只是渲染进程） |

**「滑不动」不能用来鉴别**：`EdgeSwipeBack` 在 document 上挂了 `passive: false` 的 `touchmove`，JS 主线程一旦卡住，滚动同样会被卡住——两种成因都表现为滑不动。可靠的判据是上表的「点得开弹层吗」，以及下面的埋点归因。

**归因靠墓碑**（`lib/recovery/reloadAttribution.ts`）：JS 主动重载的两条路径——本文的看门狗与 `hardRefresh()` 的版本更新——都在重载前往 localStorage 写一枚墓碑；冷启动时读 `PerformanceNavigationTiming.type`，**是 `reload` 却没有新鲜墓碑，就只可能是渲染进程被回收**（那条路径 JS 全程不知情，写不了墓碑）。窗口外或来自未来的墓碑一律不认——宁可误判成外部回收，也不能把一次真实回收算到主动路径头上，那会让频率统计偏低、掩盖问题。

因此**给看门狗加任何新的重载出口时，必须同时写墓碑**，否则那条出口会被统计成系统回收，把两族问题重新混成一团。

## 5. 关键不变量 / 坑 / 红线

1. **补拍只认 `postMessage(null)`**（§3）——放开过滤会补到无关端口，救不活还以为救了。
2. **探针不可改成同步 `setState`**（§4）——改了就恒绿，闸失效而无人察觉。
3. **看门狗的「已落地」记录不可搬进 effect**（§4）——搬了就恒红，每次回前台都重载。
4. **别再试图在构造器层预防**（§3）：那条路在生产构建下必然赶不上 `scheduler` 的求值，而且静默失效——源码里 import 顺序看着对，产物里 React chunk 先求值。验证要看 `dist` 产物的实际调用序，不是源码顺序。
5. **诊断同类现场先分通道**（§2）：先确认「点得开弹层但切不了页」这个组合成立，再往调度器上想；全都点不动是另一族原因。
6. **主动重载必须留墓碑**（§4.5）——不留就会被归因成「渲染进程被回收」，两族问题重新混作一团。
7. **`held` / `recovered` / `late` 不留墓碑、不置 `firedRef`**（§4）——留了就把下一次真实冷启动误归因成看门狗；置位了就把「下次 resume 还能自救」封死。
8. **探针累计计数必须落 localStorage**（`schedulerProbeReport.ts`）——待发送队列有上限（30 条）会挤掉早的记录，只有跨重载的累计值不会因丢记录而失真。挤出与拒收都要计数（`droppedReports`），否则「没有坏数据」与「坏数据被静默丢了」在报告里同形。
9. **早期钩子必须是 classic 内联脚本**（`index.html`）——写成 `type="module"` 会被推迟到文档解析完才执行，那时 React chunk 早就把 MessageChannel 建好了；钩子静默失效、不报任何错。`indexHtmlRecovery.test.ts` 按标签属性守它。
10. **根快照只读形态，读不到就整条回 null**（`reactRootProbe.ts`）——读的是 FiberRoot 的私有字段，React 升级会改。测试有一道形态闸直接读 `react-dom` 产物，改了会红；**绝不猜字段**，猜出来的 lane 位会让诊断整体失真而没人看得出。
11. **冷启动探针只量不救**——冷启动路径上的探针超时不补拍、不重载，只记一条。冷启动本来就慢，让它有权重载等于给自己造一个重载循环。

## 5.5 打开一次算一次：open_session

看门狗只看「调度器动没动」，但用户说的卡是「打开到能操作之间那几秒」。`lib/recovery/openSession.ts` 因此把**一次打开**收成一条记录：冷启动或从后台回前台开始，到「能点了 + 新数据到了 + 本地库探过了」三件事齐活结束，超过 `OPEN_SESSION_CAP_MS`（20 s）强制收尾。

- **边界靠 hidden 标记，不靠 focus**：前台里零星的 focus / visibilitychange 不开新会话，只有真的 hidden 过再回来才算（`lib/recovery/lastHidden.ts` 记时刻，`hooks/useAppHidden.ts` 订阅 `visibilitychange` / `pagehide` / Capacitor `appStateChange`）。不门控的话一次打开会被切成好几条，每条都很快，报告于是全绿。
- **四种收尾要分开记**：`complete`（三件事齐活）、`cap`（到顶还没齐）、`hidden`（用户等不及切走了）、`reload`（看门狗救不回来重载了）。**`cap` 不能丢**——丢掉等于把最糟的那几次从分位数里抹掉；报告脚本把它记成 `Infinity` 排到最慢端。
- **同步耗时只认会话开始之后的那条**：`sync/resourceTimingCache.ts` 缓存的是 PerformanceObserver 收到的条目，会话开始前的陈旧记录按开始墙钟时刻过滤掉，只取第一条。直接读 `getEntriesByType` 不行——那个缓冲有 250 条上限，满了之后新条目根本不入。
- 网络细分（建连 / 首字节 / 传输）要服务端放行 `Timing-Allow-Origin` 才非零，见 [deployment/configuration](../deployment/configuration.md)。

## 5.6 现场太长时丢什么：定序降级

服务端对单条 `detail` 的上限是 1000 字符，超了整批 400；客户端的上报队列也会把超长条目直接拒收。
所以两类现场都带一套**固定顺序**的降级，丢完一档仍超就丢下一档，丢过就打 `trunc: true`：

- `scheduler_probe`：先丢在途懒加载列表（`lazy`）、再丢补拍前的根快照（`rootPre`）、最后截短存储错误名（`storageErr`）。
  这个顺序按「对甲乙判定的贡献度」从低到高排——前两样丢了仍判得出甲乙，最后一样只影响丙那个交叉维度。
- `open_session`：先丢网络细分（`net`）、再清同步分段（`sync.phases`）。两步之后仍超就交给上报队列拒收。

**读数据时必须先看 `trunc`**：`trunc: true` 且 `lazy: []` 的意思是「这一条被降级过、懒加载列表已被丢掉」，
**不是**「当时没有懒加载在途」；同理 `net: null` 可能是被降级掉的，不一定是服务端没发 `Timing-Allow-Origin`。
把两者读混就会把「乙·懒加载」误判成「乙·未知挂起源」，或者跑去查线上反代。

## 6. 模块速查

| 入口 | 职责 |
|---|---|
| `lib/schedulerHostGuard.ts` | `MessagePort.prototype.postMessage` 挂钩记端口（`installSchedulerPortTap`）、补发一拍（`kickScheduler`）；配对 port2→port1 后记送达时刻（`schedulerDeliveryState` / `deliveredSince` / `pendingMessageMs`），以及绕过信道直接调处理函数（`driveSchedulerDirectly`） |
| `components/SchedulerWatchdog.tsx` | 回前台发 transition 探针，超时先补拍、再不行才重载 |
| `lib/recovery/reloadAttribution.ts` | 重载归因：主动重载留墓碑，冷启动时区分死锁自救 / 版本更新 / 渲染进程被回收 |
| `lib/recovery/schedulerProbeReport.ts` | `scheduler_probe` 记录构造、超长时的定序降级、探针累计计数（跨重载） |
| `lib/recovery/mainThreadHeartbeat.ts` | 探针挂着期间的主线程心跳，量定时器最大迟到 |
| `lib/recovery/storageProbe.ts` | 与探针同时打的一次 IndexedDB 最小往返 |
| `hooks/useAppResumeRefresh.ts` | 恢复事件订阅（visibilitychange / focus / pageshow / appStateChange），把来源透传给回调 |
| `lib/recovery/reactRootProbe.ts` | 读 FiberRoot 的 lane 位与在排回调；`TRANSITION_LANES_MASK` 在这里与 `scripts/ios-report.mjs` 各有一份，报告脚本的测试读本文件源码比对防漂 |
| `lib/recovery/lazyRegistry.ts` | 在途懒加载 chunk 登记，给「挂起的 transition」找源头 |
| `lib/recovery/storageTiming.ts` | 本地库探针计时与错误名提取（纯函数，不 import db） |
| `lib/recovery/openSession.ts` / `openSessionRuntime.ts` | 一次打开收成一条 `open_session`；单例在 runtime |
| `lib/recovery/lastHidden.ts` / `hooks/useAppHidden.ts` | hidden 标记与订阅，决定「算不算一次新的打开」 |
| `lib/recovery/reportId.ts` | 上报 id，服务端据它去重三路并发重投 |

**测试**：`lib/schedulerHostGuard.test.ts`（含「scheduler 仍以 `postMessage(null)` 排队」的前提闸）、`components/SchedulerWatchdog.test.tsx`、`lib/recovery/reactRootProbe.test.ts`（含读 `react-dom` 产物的形态闸）、`lib/recovery/openSession.test.ts`、`components/app-shell/appRoutesLazyTracking.test.ts`（守每个 lazy 路由都过 `trackLazyLoad`）、`index.html` 钩子由 `lib/recovery/indexHtmlRecovery.test.ts` 守。
