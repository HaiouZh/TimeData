# ADR 0036：React 调度器的排队信道归应用管（早期注入 `setImmediate`）

- 状态：已采纳（2026-09-21）
- 关联：延续 [ADR 0011](./0011-server-api-as-write-boundary.md) 之外无修订关系；机制见 evergreen [ios/scheduler-resilience](../evergreen/ios/scheduler-resilience.md)
- 设计来源：本地 spec `docs_local/specs/2026-09-21-ios-instant-open-换道自愈-design.md`（ios-instant-open 阶段2）

## 决策

1. **React `scheduler` 不再自建 MessageChannel**：`packages/client/index.html` 的内联 classic 脚本在 `scheduler` 模块求值前定义 `window.setImmediate` / `clearImmediate`；scheduler 按自身优先级选中 `setImmediate`，每一拍 `performWorkUntilDeadline` 都交给应用持有的信道（一条 MessageChannel + 队列，挂在 `window.__timedataBoot.schedulerTransport`）。
2. **信道可换、可直排**：机制层提供 `rotate()`（关旧端口、建新 channel、有积压就再唤醒）与 `drain()`（直排积压）；策略层 `lib/schedulerTransport.ts` 决定何时换——回前台发现端口被清空即换，否则给下一次排队挂 50 ms 兜底，兜底到点没送达就换道并转入定时器托底，信道再次送达即恢复。
3. **`setImmediate` 语义按 Node**：返回 id、可取消、参数透传；每项至多跑一次，唤醒只是唤醒。全库其他探测 `setImmediate` 的代码（Dexie 的 `asap`）拿到的是等价于 `setTimeout(0)` 的宏任务。
4. **钩子失败 = 未安装**：宿主已有 `setImmediate` 或没有 `MessageChannel` 时整段跳过，scheduler 退回自建信道；策略、看门狗、报告全部按 `installed:false` 退化，不抛。
5. **阶段1 的 `MessagePort.prototype.postMessage` 挂钩与 port2→port1 配对退役**，随之消失的还有「配对无身份校验」这条硬化项。

## 理由

- **根因在 WebKit，React 不会自愈**：WebKit 把 MessagePort 交给网络进程中转；iOS 在 App 后台期间杀网络进程是常态，回前台时网络进程被重新拉起，但 WebKit 对断连的处理是清空端口登记表、把页面里每个 MessagePort 置为 disentangled 并删掉其事件监听，**不做重建**（`WebMessagePortChannelProvider::networkProcessConnectionClosed` → `MessagePort::notifyAllConnectionsClosed`）。scheduler 自建的那条信道于是永久哑掉；补拍（往死端口再发）与直驱（绕过信道调一次处理函数）都救不了——处理函数跑完一片让出后又把下一片排回同一条死信道。2026-09 生产 10/10 卡死现场逐字段吻合。
- **`setImmediate` 是 scheduler 文档化的首选入口**，注入它比在原型层拦截投递或猜「谁 post null 谁是调度器」少两层间接，且不需要 fork / patch 依赖。
- **新建的 channel 走新连接、正常工作**：换道是唯一能让排队继续的路；定时器兜底覆盖「网络进程慢醒」这一族（IndexedDB 同在网络进程，M2 与存储探针同步变慢即此）。

## 明确不做

- 不 fork / patch `scheduler` 或 `react-dom`（依赖补丁需批准，升级要跟）。
- 不动看门狗的 5 s / 1 s 窗口（缩窗口是止血，不是治本）；看门狗降为最后防线。
- 不做 IndexedDB 断连重连（ios-instant-open 阶段3）。

## 验收

- `packages/client/src/lib/schedulerTransport.test.ts`：三态策略与「scheduler 优先用 setImmediate」形态闸（读 `scheduler` dev / production 产物）。
- `packages/client/src/indexHtmlRecovery.test.ts`：钩子的队列 / 唤醒快照 / 取消 / 换道 / 直排 / 死端口判定，以及 classic 内联与入口无 async。
- 出口按生产报告：`node scripts/ios-report.mjs` 的 M1、`deadPort` 命中数与 design §6 三条证伪条件。
