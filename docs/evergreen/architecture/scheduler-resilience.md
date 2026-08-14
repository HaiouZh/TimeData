---
type: evergreen
title: 架构 · 调度器韧性
covers:
  - packages/client/src/components/SchedulerWatchdog.tsx
  - packages/client/src/lib/schedulerHostGuard.ts
contracts:
  - packages/client/src/lib/schedulerHostGuard.ts
last-reviewed: 2026-08-14
---

# 架构 · 调度器韧性

> [architecture](../architecture.md) 的**子文档**：React 调度器为何会在 iOS 上永久停摆、怎么判定、怎么救回来。
> 不讲：iOS 保留路由栈与边缘返回手势（见 [architecture §4.5](../architecture.md#architecture-s4-5)）、原生工程构建链路（见 [deployment/ios-ipa](../deployment/ios-ipa.md)）。

## 承上启下

- **上游**：App 被系统挂起（息屏 / 切后台）后恢复。
- **下游**：所有经 React 调度器提交的更新——路由导航、`useLiveQuery` 回流、`startTransition` 包裹的一切。
- **契约**：`installSchedulerPortTap()` 须在**调度器首次排队之前**装上（`main.tsx` 模块体里、`createRoot().render()` 之前）；补拍机制押在「调度器以 `postMessage(null)` 排队」这一形态上。
- **邻居**：[architecture](../architecture.md)（主题）、[categories-settings/settings-catalog](../categories-settings/settings-catalog.md)（首帧回退的另一处 iOS 可见症状）。

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

所以现场表现是「弹层点得开、日期选择器拉得出，但底栏 tab 点不动、打点写进库了画面不刷」。**这个组合本身就是判据**：全都点不动是别的毛病（例如保留层的 `inert` 盖在屏上，见 [architecture §4.5](../architecture.md#architecture-s4-5)），只有走调度器的那半停摆才是本条。

## 3. 怎么救：补一拍

`performWorkUntilDeadline` 只要被调用一次，就会把积压干完，并在无更多工作时把开关复位，整套调度随之复活。所以解法是把丢掉的那条消息重发一遍。

补发是安全的：该函数首行就是「开关没开就什么都不做」，任务队列本身也幂等，多进入一次至多空转。

难点只在**拿到那个端口**——它活在 `scheduler` 的模块闭包里，外部够不着。`lib/schedulerHostGuard.ts` 因此在 `MessagePort.prototype.postMessage` 上挂钩，把最近一次以 `null` 排队的端口记下来；`kickScheduler()` 就是给它补发一拍。

- **钩原型，不包装 `MessageChannel` 构造器**。包装构造器只对**之后**新建的 channel 有效，而 `scheduler` 在自己被求值时（模块顶层）就把 channel 建好了；生产构建里 React 被拆进独立 chunk 并被入口 chunk 静态 import，按 ESM 语义它必然先求值——任何写在应用侧模块体里的构造器包装都赶不上，**且不会有任何报错**。钩原型与时机无关：`postMessage` 是每次排队都要走的原型方法，只需在死锁发生前装上。
- **只认 `postMessage(null)` 这一形态**。不过滤就会把页面里别的 MessageChannel 使用方（workbox 等）记进来，补拍补到无关端口上——调度器依旧卡死，而我们以为已经救过了。这个前提由测试直接读 `scheduler` 产物钉住，React 升级改了调用形态会红。
- 挂钩不改变任何投递行为，开销是每次 `postMessage` 多一次比较和一次赋值。

## 4. 什么时候救：回前台探针

`components/SchedulerWatchdog.tsx` 每次回到前台发一枚探针：`startTransition` 里递增一个计数，超时窗口（`SCHEDULER_PROBE_TIMEOUT_MS`）内没落地就判定停摆，**先补一拍**；再过一个宽限窗口（`SCHEDULER_KICK_GRACE_MS`）仍没落地，才重载页面。

- **探针必须走 transition**：同步 `setState` 那条通道没坏，用它探不出任何问题。
- **「已落地」必须在渲染期同步记录**，不能写进 `useEffect`：effect 与提交同生共死，提交本身被卡住时 effect 根本不跑，那样探到的只是「effect 还跑不跑」，永远报死。
- **补拍优先于重载**：补拍成功用户毫无感知，重载则丢掉滚动位置与未提交输入。补不出去（没记到端口 / 投递抛错）时没有中间档，直接走重载。
- **不按平台 gate**：正常平台永远不触发，成本只是每次恢复一枚定时器；而 iOS Safari 的 PWA 里 `Capacitor.getPlatform()` 返回 `web`，按平台 gate 反而漏掉真会中招的一档。
- 探针窗口取秒级而非更短：React 自己给 transition 的饥饿保护也在同一量级，正常情况早已自行收敛，还没落地的只可能是真停摆。重载保留当前 URL，路由自然回到原处；此刻页面本就冻着，没有能被打断的交互。

## 5. 关键不变量 / 坑 / 红线

1. **补拍只认 `postMessage(null)`**（§3）——放开过滤会补到无关端口，救不活还以为救了。
2. **探针不可改成同步 `setState`**（§4）——改了就恒绿，闸失效而无人察觉。
3. **看门狗的「已落地」记录不可搬进 effect**（§4）——搬了就恒红，每次回前台都重载。
4. **别再试图在构造器层预防**（§3）：那条路在生产构建下必然赶不上 `scheduler` 的求值，而且静默失效——源码里 import 顺序看着对，产物里 React chunk 先求值。验证要看 `dist` 产物的实际调用序，不是源码顺序。
5. **诊断同类现场先分通道**（§2）：先确认「点得开弹层但切不了页」这个组合成立，再往调度器上想；全都点不动是另一族原因。

## 6. 模块速查

| 入口 | 职责 |
|---|---|
| `lib/schedulerHostGuard.ts` | `MessagePort.prototype.postMessage` 挂钩记端口（`installSchedulerPortTap`）、补发一拍（`kickScheduler`） |
| `components/SchedulerWatchdog.tsx` | 回前台发 transition 探针，超时先补拍、再不行才重载 |

**测试**：`lib/schedulerHostGuard.test.ts`（含「scheduler 仍以 `postMessage(null)` 排队」的前提闸）、`components/SchedulerWatchdog.test.tsx`。
