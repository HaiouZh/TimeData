---
type: evergreen
title: 同步 · 实时通道与调度器
covers:
  - packages/server/src/sync/notifier.ts
  - packages/server/src/routes/sync.ts
  - packages/client/src/lib/syncStream.ts
  - packages/client/src/sync/scheduler.ts
  - packages/client/src/hooks/useSync.ts
  - packages/client/src/hooks/useAppResumeRefresh.ts
  - packages/client/src/hooks/useAppHideFlush.ts
  - packages/client/src/lib/cloudSyncSetting.ts
  - packages/client/src/contexts/SyncContext.tsx
contracts:
  - packages/server/src/routes/sync.ts
  - packages/shared/src/schemas.ts
last-reviewed: 2026-08-03
---

# 同步 · 实时通道与调度器

> 母主题：[sync](../sync.md)。
> 本文管的是**什么时候同步**——服务端 SSE 通知通道、客户端连接与重连、以及所有触发路径收口的模块级调度器。
> **同步了什么**（push/pull 协议、冲突解决、不变量）在母文档；域登记在 [sync/domain-registry](domain-registry.md)。

## 1. 前台 SSE 实时通知通道

服务端提供只读接口 `GET /api/sync/stream`（`packages/server/src/routes/sync.ts`）。挂在 `/api/*` 鉴权之后，客户端 fetch 流式读取、header 带 token。连接成功立刻发 `event: hello`（`{"latestSeq": ...}`），之后每 30 秒一条 `: ping` 注释心跳。

`packages/server/src/sync/notifier.ts` 维护进程内连接集合，广播函数为 `notifySyncChange(latestSeq, payload?)`；`event: bump` 的 data 形状是 `SyncStreamBumpSchema`（`{latestSeq, fromSeq?, changes?}`，`packages/shared/src/schemas.ts`）——`fromSeq`/`changes` 成对出现时收端可就地 apply，缺省即纯通知。**仅 `/api/sync/push` 构造带数据的载荷**：apply 事务结束后用 `buildBumpPayload` 读出本次 push 造成的 `(fromSeq, latestSeqAfter]` 区间 changes；超过 `BUMP_MAX_CHANGES`（50 条）或序列化后超过 `BUMP_MAX_BYTES`（32KB）任一上限就放弃 payload、退化为纯 `{latestSeq}`（常量与 `buildBumpPayload` 均在 `packages/server/src/routes/sync.ts`）。其余写路径——`/api/sync/force-push`、CLI `/api/entries` 创建、agent `POST /api/quick-notes` 投递、agent `POST /api/agent/tasks/:id/status` 回写任务状态或 tags——成功后仍只调用 `notifySyncChange(getLatestSeq())`，保持纯 bump 不变。决策与退化规则见 [ADR 0021](../../adr/0021-sse-bump-carries-changes.md)。

客户端连接逻辑在 `packages/client/src/lib/syncStream.ts`：前台可见、云同步开启且已配置 API 地址时启动；断开按 1s/2s/4s 退避封顶 30s 带抖动。每次 start 都有独立 generation、AbortController、连接超时与 watchdog，旧 run 收尾不能污染新连接；等待响应头超过 15 秒会中止并走重连。`hello` / `bump` 统一处理：远端 `latestSeq <= 本地读数` 视为回声忽略；更高则经 `shouldPullForBump` 判定后 `syncScheduler.requestSync("bump")`。设置页连接灯读 `SyncContext.connection` **与 `cloudSyncEnabled` 两个入参**（`getServerConnectionState`，`packages/client/src/pages/SettingsPage.tsx`），共五档：未配 API 地址 → 灰「未配置服务器」；已配但云同步关闭 → 灰「云同步已关闭」；其余按连接态走绿「服务器已连接」/ 黄「正在连接服务器」/ 红「服务器未连接」。**关闭档必须判在连接态之前**：关掉云同步时本节的流根本不建、`connection` 被钉成 `disconnected`，少了这一档就会与服务器真故障共用红点同文案，分不出「自己关的」还是「连不上」。云同步开关本身在 `设置 → 数据设置`（`SettingsDataPage.tsx`），与连接灯不同页。

`SyncContext` 解析每条 SSE 消息时先用 `SyncStreamBumpSchema` 校验；`event: bump` 且 `fromSeq`/`changes`/数字 `latestSeq` 三者齐全就 `stashBumpPayload()` 存入 `engine.ts` 模块级单槽（新覆盖旧、取出即清），随后仍按上一段的 `shouldPullForBump` 判定唤醒 `requestSync("bump")`。真正的零网络落地发生在 `runRegularSync`：本地无 pending 且 stash 的 `fromSeq` 与本地游标连续时，直接复用 pull 同一套 `applyPullChangesBatch` 就地写入、游标推进到 `stash.latestSeq`，跳过 `/api/sync/status` 与 `/api/sync/pull`；schema 校验失败、游标不连续、apply 抛错都自然退化为现状的 status 预查 + pull 链路；仍有 pending 时该轮走写后 push 路径、stash 原地排队（不取不清）等下一轮无 pending 再判定——各分支都不丢事件也不跳号。

连接带**心跳看门狗**（`STREAM_WATCHDOG_TIMEOUT_MS=45_000`）：每次收到任何字节（含服务端 30 秒一条的 `: ping` 注释心跳）都重置一个 45 秒定时器；定时器到期说明连接已静默断线但底层 fetch 流未报错，主动 `abort()` 触发既有重连退避路径。`stop()` 会同步清理看门狗定时器。服务端心跳节奏本身零改动。

服务端 stream 先注册 listener，再读取并发送 hello；hello 写出前到达的 bump 暂存在连接内，hello 后若账本确实前进再补发。这样没有“hello 已读旧 seq、listener 尚未注册”的丢事件窗口。

通知器与 force-push token 一样是单进程内存状态；`SERVER_REPLICAS>1` 时启动告警，真正多实例前需要 Redis pub/sub 等跨实例转发。

## 2. 客户端调度器

所有触发 `regularSync()` 的路径统一收口到模块级单例 `syncScheduler`（`packages/client/src/sync/scheduler.ts`）。它不依赖 React，`SyncContext` 挂载时经 `setExecutor()` 注册一个包装了 `useSync().sync` 的 executor，卸载或云同步关闭时注销（`setExecutor(null)`）。

**触发下沉到写入本身**：`recordSyncLog()`（`engine.ts`）每次成功写入 Dexie `syncLog` 后调用 `syncScheduler.notifyWrite()`；批量写入用新增的 `recordSyncLogs(entries)` helper（同样内部调 `notifyWrite()`）。这意味着任何写 `syncLog` 的路径（包括此前遗漏接线的页面、以及 bootstrap 期 `runMaterialization`）都自动获得写后同步，无需页面显式调用同步函数。

**触发原因（`SyncRequestReason`）**：`write`（写入触发）、`bump`（SSE 提示账本前进）、`resume`（回前台）、`reconnect`（SSE 重连成功且上次同步失败）、`fallback`（60 秒兜底 interval）、`flush`（隐藏前尝试推送）、`startup`（executor 注册时的启动 kick）。`requestSync(reason)` 供上述场景显式调用；`notifyWrite()` 是 `write` 原因的专用入口。

**防抖与硬上限**：每次触发用 300ms trailing 防抖合并突发写入；同时有 2s max-wait 硬上限，避免连续写入无限推迟执行。执行中如果又被新触发拦截，不会打断当前这轮，而是记下待处理原因，等本轮结束后自动补跑一次——补跑的 `waitMs`（executor 收到的 `SyncExecutorMeta.waitMs`）如实累计从首次触发到真正执行的等待时长，不清零重算。

**失败与兜底**：任意执行失败（包括纯 pull）保留 retry-needed，按 1s/2s/4s 指数退避、封顶 60s；429 优先尊重响应 body 或真实 `ApiError.headers` 中的 `Retry-After`。成功、关闭云同步或 executor 换代会清掉旧重试状态。60 秒 fallback 仍只做低频保险：有本地 pending 或 retry-needed 才调度，不在成功路径空转。hidden/pagehide flush 会检查真实 outbox/retry 状态，退避中允许一次隐藏前立即尝试；并发的 outbox 预检单飞且绑定 executor generation，连续 hidden/pagehide 不重复发两轮，旧 generation 的迟到查询也不能给新 executor 排任务。没有 executor 时触发只记脏标记，重新注册时再兑现。

**生命周期接线**（`SyncContext.tsx`）：云同步启用且服务器配置完整时，`useAppResumeRefresh` 回前台触发 `requestSync("resume")`；关闭云同步会注销 executor 且不建立 SSE。`useSync.sync(meta)` 用 `Capacitor.getPlatform()` 与该 reason 选择 transport，只有 Android `resume` 把普通同步的 status/增量 pull 交给显式原生 HTTP，其余 reason 保持 Web，完整网络边界见 [母文档](../sync.md#sync-overall-flow)。`useAppHideFlush`（`hooks/useAppHideFlush.ts`，监听 `visibilitychange` hidden、`pagehide`、Capacitor 原生 `appStateChange` 的 `!isActive`）在应用隐藏前调 `flushNow()` 尝试立即推送——这是一次普通 fire-and-forget 的 `sync()`，不使用 `navigator.sendBeacon` / fetch keepalive（keepalive 请求体有 64KB 上限，同步 payload 可能超限，取舍是尽力而为而非保证送达）。页面可复用 `useAppResumeRefresh` 刷新当前时间或默认值，但同步触发只由 `SyncContext` 接线。

**与手动同步的关系**：设置页手动"立即同步"按钮直调 `sync()`，不经过 `syncScheduler`；`engine.ts` 的 `regularSyncInFlight` 单飞去重仍然生效，手动触发和调度器触发并发时不会重复跑两轮同步。
