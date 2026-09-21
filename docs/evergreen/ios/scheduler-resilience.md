---
type: evergreen
title: iOS 壳 · 调度器韧性
covers:
  - packages/client/src/components/SchedulerWatchdog.tsx
  - packages/client/src/lib/schedulerTransport.ts
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
  - packages/client/src/lib/schedulerTransport.ts
  - packages/client/src/lib/recovery/reactRootProbe.ts
  - packages/client/src/lib/recovery/openSession.ts
last-reviewed: 2026-09-21
---

# iOS 壳 · 调度器韧性

> [ios](../ios.md) 的**子文档**：React 调度器为何会在 iOS 上永久停摆、怎么判定、怎么救回来。
> 不讲：iOS 保留路由栈与边缘返回手势（见 [page-stack](page-stack.md)）、原生工程构建链路（见 [母文档](../ios.md) §2）。

## 承上启下

- **上游**：App 被系统挂起（息屏 / 切后台）后恢复。
- **下游**：所有经 React 调度器提交的更新——路由导航、`useLiveQuery` 回流、`startTransition` 包裹的一切。
- **契约**：`index.html` 的内联钩子须在 `scheduler` 求值前定义 `setImmediate`（classic 内联脚本）；`installSchedulerTransportPolicy()` 在 `main.tsx` 模块体里、`createRoot().render()` 之前接管；整套换道押在「scheduler 有 `setImmediate` 就用它、不再自建 MessageChannel」这一形态上（[ADR 0036](../../adr/0036-scheduler-transport-owned-by-app.md)）。
- **邻居**：[ios](../ios.md)（母文档）、[categories-settings/settings-catalog](../categories-settings/settings-catalog.md)（首帧回退的另一处 iOS 可见症状）。

## 1. 死锁怎么形成

React 的调度器（`scheduler` 包）在模块求值时选一条排队信道：有 `setImmediate` 就用它，否则自建一条 `MessageChannel`（`port2.postMessage(null)` 发出、`port1.onmessage` 收到后才开工）。其内部有个「消息循环已在跑」的开关，**只有那条消息真的送达并处理完才复位**，排队入口对该开关有守卫——是 true 就不再发新消息。

WebKit 里 MessagePort 由**网络进程**中转。App 在后台期间 iOS 常把网络进程杀掉，回前台时网络进程被重新拉起，但 WebKit 对断连的处理是：清空「网络进程认识的端口」登记表，把页面里**每一个** MessagePort 置为 disentangled 并删掉其全部事件监听（`onmessage` 也没了），**不做任何重建**（`WebMessagePortChannelProvider::networkProcessConnectionClosed` → `MessagePort::notifyAllConnectionsClosed`）。于是 React 自建的那条信道从此永久哑掉：开关停在 true、往它上面补发多少拍都送不到；就算绕过信道直接调一次处理函数，跑完一片让出后它又把下一片排进同一条死信道。安卓的 Chromium WebView 不这么处理，故此症状是 iOS 独有（iOS Safari 的 PWA 同属 WebKit，一样会中）。IndexedDB 同在网络进程，所以本地库报 `UnknownError` 常与之共现；网络进程只是慢醒（没死）时，信道与本地库会一起慢几百毫秒到一秒。

2026-09 生产数据（ios-instant-open 阶段1）10/10 卡死现场 `delivered:false`、`suspendedLanes` 为 0、直驱只清掉 DefaultLane，与上述机制逐项吻合。

## 2. 现场为什么是「半瘫」而不是「全死」

React 按 lane 决定更新走哪条通道，两条通道在死锁后的存活状态是分开的：

| 更新来源 | 通道 | 死锁后 |
|---|---|---|
| 点击 / 输入等离散事件里直接 `setState` | 微任务（`queueMicrotask`） | 照常生效 |
| `startTransition` 包裹的更新（react-router 的导航即在此列） | 调度器 | 停摆 |
| 异步回调里的 `setState`（Dexie `useLiveQuery` 回流） | 调度器 | 停摆 |

所以现场表现是「弹层点得开、日期选择器拉得出，但底栏 tab 点不动、打点写进库了画面不刷」。**这个组合本身就是判据**：全都点不动是别的毛病（例如保留层的 `inert` 盖在屏上，见 [page-stack](page-stack.md)），只有走调度器的那半停摆才是本条。

## 3. 怎么救：信道归应用管，死了就换

修法不是补拍，是**不让 React 自建信道**：`index.html` 的内联 classic 脚本 `td-boot-scheduler-transport` 在 `scheduler` 求值前定义 `window.setImmediate`（与 `clearImmediate`），scheduler 按自己的优先级选中它，每一拍 `performWorkUntilDeadline` 都交给我们的信道——一条 MessageChannel + 一个队列，挂在 `window.__timedataBoot.schedulerTransport`。信道随时可 `rotate()` 换新（关旧端口、新建 channel、队里有东西就再唤醒一次），也可 `drain()` 直排积压。

- **只装机制不装策略**：钩子里只有队列、channel、计数与 `rotate / drain / cancel / portDead / snapshot`；什么时候换在 `lib/schedulerTransport.ts`（§4）。
- **唤醒不携带任务**：每次 `schedule` 入队一项并 post 一条 wake；wake 只跑**那一刻**已在队里的项，跑的过程中新入队的由它自己的 wake 跑——否则等于吃掉调度器的让出，一整段 transition 被同步跑完。多余的 wake 空转无害，所以换道时重发、直排后信道又送达都不会把任务跑两次。
- **`setImmediate` 语义按 Node**：返回 id、可取消、参数透传。全库另一个探测它的是 Dexie 的 `asap`，拿到的是「宏任务里跑一次」，与 `setTimeout(0)` 等价。
- **失败即未安装**：钩子整段 try/catch；宿主已有 `setImmediate` 或没有 `MessageChannel` 就跳过，scheduler 退回自建信道，策略 / 看门狗 / 报告都按 `installed:false` 退化、不抛。
- **为什么必须在 HTML 里**：scheduler 在自己的模块求值时就选好信道；生产构建里 React chunk 先于入口模块求值，应用模块里任何钩子都赶不上、且不会有任何报错。classic 内联脚本在解析期同步执行、非 async 的 module 脚本一律在解析完成后执行，时序由 HTML 规范保证、与位置无关。

## 4. 什么时候换：回前台三态策略 + 看门狗兜底

**策略（`lib/schedulerTransport.ts`）三态**：`confirmed`（信道刚送达过，零定时器）→ 回前台标 `suspect`（下一次排队挂一枚 `TRANSPORT_FALLBACK_MS` = 50 ms 兜底）→ 兜底到点没送达即换新信道、直排积压、进 `degraded`（此后每次排队同时排一枚 `setTimeout(0)`）→ 信道一旦送达回 `confirmed`。回前台先查 `portDead()`（port1.onmessage 被 WebKit 清空）：命中立即换道并计 `deadPorts`，既是快路径也是根因命中的现场证据；`degraded` 下回前台也顺手换新。50 ms 的依据：正常送达在 1 ms 内，主线程忙时定时器同样到不了、不会误触；误触的代价只是多换一条信道、多跑一次空 drain。

**看门狗（`components/SchedulerWatchdog.tsx`）是策略失灵时的最后防线**：每次回到前台发一枚探针——`startTransition` 里递增一个计数，超时窗口（`SCHEDULER_PROBE_TIMEOUT_MS`）内没落地就判定停摆，**先补一拍**（`kickSchedulerTransport`：强制换新信道 + 直排 + 进 `degraded`）；再过一个宽限窗口（`SCHEDULER_KICK_GRACE_MS`）仍没落地，才重载页面。

- **探针必须走 transition**：同步 `setState` 那条通道没坏，用它探不出任何问题。
- **「已落地」必须在渲染期同步记录**，不能写进 `useEffect`：effect 与提交同生共死，提交本身被卡住时 effect 根本不跑，那样探到的只是「effect 还跑不跑」，永远报死。
- **补拍优先于重载，判定三分**：补拍成功用户毫无感知，重载则丢掉滚动位置与未提交输入。超时那一刻先读端口在不在、真实等了多久，再补一拍——**不可见也照补、补不出去也不早退**（没发出去不代表调度器一定死了）；宽限结束那一刻再读可见性（提前采样会让中间切走的用户在后台被重载），按「落地了 → `recovered` 不重载 / 没落地且可见 → `reload` 留墓碑重载 / 没落地且不可见 → `held` 不重载、不封锁下次自救」三分。探针挂着期间再来的恢复事件只累加计数，**不重发探针、不重置定时器**——重置会把超时与宽限一并后推，真死锁时自救被无限推迟。
- **每次超时都记现场**：`scheduler_probe`（`lib/recovery/schedulerProbeReport.ts`）搭同步上报的车，字段与分辨表见 `docs_local` 里的观测口径 design §2.1 / §0.4。正常落地零上报；只有一个例外——探针落地了但定时器迟到 ≥ 2 个窗口记 `late`，那是「线程 / App 被冻、用户照样在等、看门狗却没动」唯一能被看见的地方。
- **两枚旁证探针只在看门狗挂着的几秒内跑**：主线程心跳（`mainThreadHeartbeat.ts`，250ms 一拍，量最大迟到）与 IndexedDB 最小往返（`storageProbe.ts`）。心跳迟到 ≈ 等待时长 → 线程被冻，不是调度器的事；IndexedDB 判定时没回来（`storageMs` 为 null）→ 存储层被冻，抛错记 -1——两者在数据里分开，存储报错不能被读成存储被冻。
- **「没落地」还要再分一次叉**：只知道没落地，分不出是消息没送回来还是 React 自己在等。三路证据合起来判：`schedulerTransport` 记信道最近收发时刻与代数 / 状态（`delivered` / `pendingMsgMs` / `gen` / `mode` / `fallbacks` / `deadPorts`），`reactRootProbe` 读 FiberRoot 的 lane 位（`rootPre` / `rootPost`），`lazyRegistry` 报在途的懒加载 chunk（`lazy`）。判定口径、证伪条件与报告脚本见 `docs_local` 的 ios-instant-open 阶段1 design §2.8 与阶段2 design §6。
- **补拍后再等 250ms 新信道仍没送达就再直排一次**（`drainSchedulerTransport`），结果记 `direct`。直排必须同步调、不能再排一跳宏任务：定时器被整体冻住时多排的那一跳会落在宽限判定之后。
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

1. **wake 只跑那一刻已在队里的项**（§3）——连新入队的一起跑就是吃掉调度器的让出，整段 transition 同步跑完、输入被饿死。
2. **探针不可改成同步 `setState`**（§4）——改了就恒绿，闸失效而无人察觉。
3. **看门狗的「已落地」记录不可搬进 effect**（§4）——搬了就恒红，每次回前台都重载。
4. **别再试图在应用模块里装钩子**（§3）：那条路在生产构建下必然赶不上 `scheduler` 的求值，而且静默失效——源码里 import 顺序看着对，产物里 React chunk 先求值。只有 `index.html` 的 classic 内联脚本来得及；验证看 `dist` 产物。
5. **诊断同类现场先分通道**（§2）：先确认「点得开弹层但切不了页」这个组合成立，再往调度器上想；全都点不动是另一族原因。
6. **主动重载必须留墓碑**（§4.5）——不留就会被归因成「渲染进程被回收」，两族问题重新混作一团。
7. **`held` / `recovered` / `late` 不留墓碑、不置 `firedRef`**（§4）——留了就把下一次真实冷启动误归因成看门狗；置位了就把「下次 resume 还能自救」封死。
8. **探针累计计数必须落 localStorage**（`schedulerProbeReport.ts`）——待发送队列有上限（30 条）会挤掉早的记录，只有跨重载的累计值不会因丢记录而失真。挤出与拒收都要计数（`droppedReports`），否则「没有坏数据」与「坏数据被静默丢了」在报告里同形。
9. **早期钩子必须是 classic 内联脚本**（`index.html`）——写成 `type="module"` 会被推迟到文档解析完才执行，那时 scheduler 早就选好了自建信道；`setImmediate` 装晚了静默失效、不报任何错。`indexHtmlRecovery.test.ts` 按标签属性守它，`schedulerTransport.test.ts` 读 scheduler 产物守「有 setImmediate 就用它」。
10. **根快照只读形态，读不到就整条回 null**（`reactRootProbe.ts`）——读的是 FiberRoot 的私有字段，React 升级会改。测试有一道形态闸直接读 `react-dom` 产物，改了会红；**绝不猜字段**，猜出来的 lane 位会让诊断整体失真而没人看得出。
11. **冷启动探针只量不救**——冷启动路径上的探针超时不补拍、不重载，只记一条。冷启动本来就慢，让它有权重载等于给自己造一个重载循环。
12. **每项至多跑一次、唤醒可以多**（§3）——换道重发、直排、兜底都只是唤醒；把任务塞进消息里就会在换道时跑两遍。
13. **`confirmed` 下零定时器；`suspect` 至多一枚兜底；`degraded` 至多一枚 `setTimeout(0)` 在途**（§4）——每次排队都挂就是定时器成堆，iOS 该睡时被反复叫醒。
14. **旧端口一律 `close()`、`gen` 只增；钩子失败 = 未安装**——所有下游按 `installed:false` 退化，不许因为钩子没装上而抛错或假装装上了。

## 5.5 打开一次算一次：open_session

看门狗只看「调度器动没动」，但用户说的卡是「打开到能操作之间那几秒」。`lib/recovery/openSession.ts` 因此把**一次打开**收成一条记录：冷启动或从后台回前台开始，到「能点了 + 新数据到了 + 本地库探过了」三件事齐活结束，超过 `OPEN_SESSION_CAP_MS`（20 s）强制收尾。

- **边界靠 hidden 标记，不靠 focus**：前台里零星的 focus / visibilitychange 不开新会话，只有真的 hidden 过再回来才算（`lib/recovery/lastHidden.ts` 记时刻，`hooks/useAppHidden.ts` 订阅 `visibilitychange` / `pagehide` / Capacitor `appStateChange`）。不门控的话一次打开会被切成好几条，每条都很快，报告于是全绿。
- **四种收尾要分开记**：`complete`（三件事齐活）、`cap`（到顶还没齐）、`hidden`（用户等不及切走了）、`reload`（看门狗救不回来重载了）。**`cap` 不能丢**——丢掉等于把最糟的那几次从分位数里抹掉；报告脚本把它记成 `Infinity` 排到最慢端。
- **同步耗时只认会话开始之后的那条**：`sync/resourceTimingCache.ts` 缓存的是 PerformanceObserver 收到的条目，会话开始前的陈旧记录按开始墙钟时刻过滤掉，只取第一条。直接读 `getEntriesByType` 不行——那个缓冲有 250 条上限，满了之后新条目根本不入。
- 网络细分（建连 / 首字节 / 传输）要服务端放行 `Timing-Allow-Origin` 才非零，见 [deployment/configuration](../deployment/configuration.md)。
- **信道账只记会话内增量**（`transport: { rotations, fallbacks, deadPort, mode }`）：以 begin 时的累计值为基线做差，`deadPort` 看计数有没有涨。记页面级累计值会把上一次打开的换道算到这一次头上。降级顺序 `net` → `transport` → `sync.phases`。

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
| `index.html` `td-boot-scheduler-transport` | 机制层：在 scheduler 求值前定义 `setImmediate`，持有信道（channel + 队列）与 `rotate / drain / cancel / portDead / snapshot` |
| `lib/schedulerTransport.ts` | 策略层：接管钩子（`installSchedulerTransportPolicy`）、三态与回前台换道；给看门狗的 `kickSchedulerTransport` / `drainSchedulerTransport`，给现场的 `schedulerDeliveryState` / `transportState` / `deliveredSince` / `pendingMessageMs` |
| `components/SchedulerWatchdog.tsx` | 回前台发 transition 探针，超时先补拍（换道 + 直排）、再不行才重载 |
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

**测试**：`lib/schedulerTransport.test.ts`（三态策略，含「scheduler 优先用 `setImmediate`」的形态闸）、`components/SchedulerWatchdog.test.tsx`、`lib/recovery/reactRootProbe.test.ts`（含读 `react-dom` 产物的形态闸）、`lib/recovery/openSession.test.ts`、`components/app-shell/appRoutesLazyTracking.test.ts`（守每个 lazy 路由都过 `trackLazyLoad`）、`index.html` 钩子的队列 / 唤醒 / 换道行为由 `indexHtmlRecovery.test.ts` 守。
