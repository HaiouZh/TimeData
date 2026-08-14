---
type: evergreen
title: 同步 · 观测与排障
covers:
  - packages/client/src/components/SyncTimingsPanel.tsx
contracts:
  - packages/client/src/components/SyncTimingsPanel.tsx
  - packages/client/src/db/index.ts
  - packages/client/src/lib/storageKeys.ts
  - packages/client/src/sync/engine.ts
  - packages/client/src/sync/phaseTimings.ts
  - packages/client/src/sync/scheduler.ts
  - packages/client/src/sync/transport.ts
  - packages/client/src/hooks/useSync.ts
  - packages/server/src/routes/admin/sync.ts
  - packages/server/src/routes/sync.ts
  - packages/server/src/routes/syncLog.ts
last-reviewed: 2026-08-14
---

# 同步 · 观测与排障

> 母主题：[sync](../sync.md)。
> 本文是一条纵切读者路径：同步已经发生或变慢时，如何从日志、耗时和服务端审计定位慢点。
> 不讲 push/pull 协议、域登记簿或调度器设计；分别见 [sync](../sync.md)、[domain-registry](domain-registry.md)、[realtime-and-scheduler](realtime-and-scheduler.md)。

## 1. 两套同步日志

| 表 | 在哪 | 作用 |
|---|---|---|
| Dexie `syncLog` | 客户端 IndexedDB | 待同步队列；`synced=0/1/2`（0=待上传，1=已同步/已放弃，2=死信隔离）；仅 `synced=0` 会被 push |
| SQLite `sync_logs` | 服务端 | 运维审计；记录每次 push/pull 及相关观测摘要 |

客户端每轮有实际动作的 `regularSync`（补差或 push+pull）会向 `/api/admin/sync-logs` 写审计摘要；这条上报是 fire-and-forget，不 await、不阻塞同步返回，自身吞错。它走 admin 鉴权、admin 限流，并与 `X-Confirm` 清空确认处在同一管理命名空间。

`/api/admin/sync` 读取最近 50 条服务端 `sync_logs`。客户端 cursor key 集中在 `packages/client/src/db/index.ts`（`LAST_SYNCED_SEQ_KEY`），`resetSyncCursors()` 清理读数并顺手清理遗留 key `timedata_last_synced` / `timedata_legacy_snapshot_sync`。

**syncLog 卫生**：未同步查询统一走索引（`where("synced").equals(0)` 或 `[tableName+synced]`），不做全表 `.filter()` 扫描。`synced` 用数字（`0|1|2`）正是为可索引而设。`synced=1/2` 历史行由每轮成功同步收尾的 `pruneSyncedLogs()` 按 7 天窗口清理；no-op 早退分支不清理，保持零写入。清理失败不算整轮同步失败，也不占同步窗口。

## 2. 分段耗时观测

`useSync.sync()` 每轮用 `createPhaseRecorder()`（`packages/client/src/sync/phaseTimings.ts`）给 status / push / pull / bumpApply 阶段计时。写后路径只有 push/pull；补差路径只有 status/pull；SSE bump payload 就地应用只有 bumpApply。无论成功还是失败，收尾都会落一条 `SyncTimingEntry` 到 localStorage `timedata_sync_phase_timings` 环形缓冲（最多 20 条，最新在前）。

`SyncTimingEntry` 的诊断字段来自调度器 `SyncExecutorMeta`、SSE 连接态与本轮实际请求：`waitMs`（executor 触发前排队时长）、`reason`（`SyncRequestReason`）、`connection`（触发时的 `SyncStreamState`）、`transport`（`web`、`native-android` 或 `mixed`）和可选 `protocol`。`getSyncTimings()` 读取时做逐元素 shape 校验，坏元素丢弃；`phases` 允许携带未知阶段键，存量旧数据无需迁移。

设置页同步卡片展示最近一次各阶段耗时、p50/p95，以及最新一条的 `waitMs` / `reason` / `connection` / `transport`。带 push 或补差的那一轮，客户端审计日志会多写 `action: "phase_timings"`；服务端侧 push/pull 在 `sync_logs.detail.timings` 记录 parse / validate / apply / read / total 等阶段耗时。这套观测纯附加，不改变任何同步判定或行为。

## 3. 同步慢排查入口

同步指示灯开始闪只说明客户端进入了同步轮次，不能据此判断慢在调度器、网络还是服务端。排查先固定一条完整时间线（触发动作、指示灯开始、最新数据可见），再按以下顺序对同一轮数据取证：

1. **先看 `reason` 与 `waitMs`**：回前台问题应看到 `reason=resume`。`waitMs` 本身已接近用户感知延迟时，慢点在 executor 之前，优先查上一轮单飞、scheduler 防抖/退避和生命周期接线；入口是 [realtime-and-scheduler](realtime-and-scheduler.md) 第 2 节。
2. **再看客户端阶段**：`waitMs` 很小而 `status` / `pull` 很大，说明同步已及时启动，长尾在请求阶段。Android resume 的增量补差应记录 `transport=native-android`；Web push 后再原生 pull、或 native status 后退到 `sinceSeq=0` Web 全量 pull 时是 `mixed`。出现 `transport=web` 时先核对触发原因、平台、插件可用性和是否走全量拉取。
3. **客户端与服务端对表**：把设置页阶段耗时与服务端 `sync_logs.timings`、请求审计到达时间 / 次数放在同一时间窗。客户端阶段长而服务端 `totalMs` 只有毫秒级，瓶颈在请求到达服务端之前或响应返回客户端之后，继续查 WebView/原生连接、DNS、VPN/TUN、代理、TLS、CORS 预检；两边同时长才优先查 server/SQLite。服务端完全没有对应请求时，也不能把等待归因于数据库。
4. **最后按平台做对照**：同一服务端、同一网络下比较 Web/PWA 与 Android APK，并重复采样看 p50/p95，不用单次秒表下结论。Android 原生 HTTP 只绕过浏览器 CORS enforcement 和 WebView 连接栈，不绕过系统 DNS、VPN、代理、TLS 或服务端链路；网络边界见 [deployment](../deployment.md) 与 [android](../android.md)。

**pull 返回的 changes 条数少于账本区间跨度是正常现象，不是丢数据**：`readChangesSinceSeq` 跳过两类账本记录——读不到当前业务行的（已被后续变更覆盖或删除），以及 `table_name` 已不在域登记簿的（账本只增，已退役域的历史记录永久保留，见 [domain-registry](domain-registry.md)）。游标 `nextSinceSeq` 按 seq 号前进而非按 change 数前进，因此**响应里的 seq 跳号本身不构成故障信号**；判断是否真丢数据要比对具体 record，不能数条数。

取证最小集是：客户端最近一条 `waitMs/reason/connection/transport` 与 status/push/pull 分段、服务端同时间窗的 sync/request logs、APK build id、Android 当时的 VPN/代理状态。先完成这组对表，再决定改 scheduler、transport、CORS/网络还是 server；不要从“安卓慢”直接跳到全局启用 CapacitorHttp，也不要在请求可能已经发出后盲目换 transport 重发写请求。
