---
type: evergreen
title: 同步机制
covers:
  - packages/server/src/sync/backup.ts
  - packages/server/src/sync/conflict.ts
  - packages/server/src/sync/forcePushValidation.ts
  - packages/server/src/sync/order.ts
  - packages/server/src/sync/resolver.ts
  - packages/server/src/sync/seq.ts
  - packages/server/src/sync/state.ts
  - packages/server/src/sync/validation.ts
  - packages/server/src/db/backfillSeq.ts
  - packages/server/src/db/utcReset.ts
  - packages/server/src/db/schema.ts
  - packages/server/src/routes/data.ts
  - packages/server/src/routes/sync.ts
  - packages/server/src/routes/syncLog.ts
  - packages/client/src/sync/changes.ts
  - packages/client/src/sync/conflicts.ts
  - packages/client/src/sync/engine.ts
  - packages/client/src/sync/reason.ts
  - packages/client/src/sync/phaseTimings.ts
  - packages/client/src/sync/transport.ts
  - packages/client/src/lib/api.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/taskCompletion.ts
  - packages/shared/src/trackStatusOp.ts
  - packages/shared/src/types.ts:SyncPushOutcome
  - packages/shared/src/types.ts:SyncPushReasonCode
  - packages/shared/src/types.ts:SyncReasonCategory
  - packages/shared/src/types.ts:SyncPullRequest
  - packages/shared/src/types.ts:SyncPullResponse
  - packages/shared/src/types.ts:SyncDatasetStatus
  - packages/shared/src/types.ts:SyncStatusResponse
  - packages/shared/src/types.ts:SyncForcePushPrepareRequest
  - packages/shared/src/types.ts:SyncForcePushPrepareResponse
  - packages/shared/src/types.ts:SyncForcePushRequest
  - packages/shared/src/types.ts:SyncForcePushResponse
  - packages/shared/src/types.ts:SyncHealthReport
contracts:
  - packages/shared/src/syncDomains.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/taskCompletion.ts
  - packages/shared/src/trackStatusOp.ts
  - packages/shared/src/types.ts:TaskCompletionOp
  - packages/shared/src/types.ts:SyncPushOutcome
  - packages/shared/src/types.ts:SyncPushReasonCode
  - packages/client/src/sync/reason.ts
  - packages/server/src/db/schema.ts
  - packages/server/src/db/reset.ts
  - packages/server/src/db/backfillSeq.ts
  - packages/server/src/db/utcReset.ts
  - packages/server/src/routes/data.ts
  - packages/server/src/sync/domains.ts
last-reviewed: 2026-08-05
---

# 同步机制

> 同步是这个项目最复杂的部分。这份文档讲：账本模型、域登记簿、流程、冲突解决规则、`SyncPushReasonCode` 含义、关键约束。
> Backup 是另一回事，见 [`backup.md`](./backup.md)。架构决策见 [`ADR 0012`](../adr/0012-sync-ledger-and-domain-registry.md)。

<a id="sync-ledger-registry"></a>

## 0. 账本模型与域登记簿

同步内核是一个**账本模型**：

- 服务器 SQLite `sync_seq` 表是只增不减的权威变更序列（账本）。每笔成功写入（任何域、任何入口）都追加一行并获得递增编号。
- 每台设备只持有一个读数：`localStorage.timedata_last_synced_seq`。追数据只有一种问法："`sinceSeq` 之后给我"。
- `updated_at` / `deleted_at` 由服务器在记账时分配（`resolver.ts` 的 `serverNow`）；排序权威是账本编号。客户端提交的 `change.timestamp` 不落库，但在 `baseSeq` 冲突记录上用于 staleGuard 时间戳线性化；设备时钟偏差超过 60 秒会在设置页提示用户校准。

**域登记簿**决定系统认识哪些数据类型：shared `SYNC_DOMAINS` 负责运行时 schema、优先级、冲突策略和计数语义；server `SERVER_SYNC_DOMAINS` 负责校验 / 写入 / pull 读回；client `CLIENT_SYNC_DOMAINS` 负责 Dexie store、pull 应用与备份角色。登记簿细节、当前 16 个运行时域、新增普通 LWW 域与复合键域的完整 checklist，见子文档 [sync/domain-registry](sync/domain-registry.md)。

**登记簿是封闭契约**：新增域必须同步 shared 配置、server 钩子/映射、客户端 Dexie 表与 pull 分支、静态 `SyncChange` 类型、backup 角色和文档，不能让运行时登记簿、静态判别联合、客户端登记簿三者分叉。

实体字段演进不等于新增同步域：例如 `Task.weight` 是既有 `tasks` LWW 域的结构化字段，随 `TaskSchema`、Dexie/SQLite 映射、backup/force-push 和 sync pull/push 载荷一起演进，不增加运行时域数量，也不扩展 `SyncPushReasonCode`。

<a id="sync-overall-flow"></a>

## 1. 整体流程

客户端入口是 `regularSync()`（`packages/client/src/sync/engine.ts`）。同一 JS context 内如果已有一次 `regularSync()` 尚未结束，新的调用会复用进行中的 promise；这只去重同浏览器上下文里的快速重复触发，不是跨 tab leader election。

```
1. 先查本地未同步计数（Dexie syncLog，走 synced 索引，纯本地）
2. unsyncedCount>0（写后路径）：直接 syncPush()（合并、压缩、带分类依赖）；push 回执带
   latestSeq/appliedCount，无别的设备插队（latestSeq − baseSeq === appliedCount 且 push 全干净）时
   直接推进游标、跳过回声 pull（写后仅 1 请求）；否则 syncPullSinceSeq() 补差。
   不发 /api/sync/status——status 的唯一用途是 no-op 判定，有待上传时该判定恒为假
3. unsyncedCount=0：GET /api/sync/status 取云端 latestSeq；
   latestSeq <= 本地读数 → no-op（不 push、不 pull）；否则 syncPullSinceSeq() 补差
4. resolveConflicts()（UI 决定）keep_local 还是 use_remote
5. reportToServer() 通过 `/api/admin/sync-logs` 写一条 sync_logs 摘要
   （fire-and-forget：不 await、不计入同步窗口，自身吞错）
6. 有实际动作的成功分支收尾 pruneSyncedLogs()：synced=1 的历史日志按 7 天窗口清理
   （第 3 步 no-op 早退不清理——那条路径零写入、零请求，连回执都不产生）
```

写后阻塞链路因此至多 push + pull 两个网络请求，且无插队时进一步降到仅 push 一个（push 回执带 latestSeq/appliedCount，判定无插队即跳过回声 pull，见 [ADR 0016](../adr/0016-push-latestseq-and-pull-pagination.md)）。主链无前置探活：服务器不可达时由 push/status 请求本身报错走 `setError`（`lib/serverHealth.ts` 仅供诊断场景）。同步前不创建本地快照备份（[ADR 0015](../adr/0015-remove-client-auto-snapshots.md)）。

no-op 判定只比较账本读数，不算哈希、不数行数、不拉快照。`contentHash` 只是诊断工具：`getSyncHealth()`（设置页同步健康诊断）仍用它做本地与云端的深度体检。

客户端请求统一走 `apiFetch()`（`packages/client/src/lib/api.ts`）：它负责拼接 API 根地址、附带 Bearer Token、保留 API 错误响应 JSON、合并调用方 `AbortSignal` 与内部超时信号；全量拉取可在调用处显式给更长 timeout。Web `fetch` 的成功响应体如果不是合法 JSON，会抛出包含 URL 与响应片段的人类可读错误；原生响应由 Capacitor 解码后再由 status/pull schema 校验；204 / 空 body 视为 `undefined`。

Android 原生同步通道是显式、窄范围的 transport 选择：只有 `Capacitor.getPlatform() === "android"` 且调度原因是 `resume` 时，普通同步的 `/api/sync/status` 与 `sinceSeq > 0` 的增量 `/api/sync/pull` 才使用 `native-android`；Web/PWA 以及启动、写入、重连、定时兜底等原因继续使用 Web `fetch`。原生适配调用 Capacitor 7 内置 `CapacitorHttp`（Android `HttpURLConnection`），复用 URL、Bearer、`Content-Type`、`X-TimeData-Client-Build` 和 TOTP headers，并继续由客户端做 pull schema 校验与分页游标推进。`sinceSeq: 0` 全量拉取、push、force-push、健康诊断、管理/日记/备份 API 和 SSE 均保持 Web `fetch`；不启用全局 `CapacitorHttp` fetch/XHR patch。

`CapacitorHttp` 返回完整响应体且没有逐请求 `AbortSignal`/cancel，因此原生请求不复用 Web hedge：一次 JS 超时或调用方 abort 只停止等待，底层 Android 连接可能仍在完成；原生 HTTP 失败不盲目重发 Web 请求，避免已到达服务端的 POST 产生重复写。原生 HTTP 错误仍归一为 `ApiError`（保留 status、headers 和 body），不可用或非 Android 平台在请求发出前回到 Web 默认路径。Android 原生路径绕过浏览器 CORS enforcement，但不绕过系统 DNS、VPN、代理、TLS 或服务器链路，HTTPS-only 约束仍然有效。

客户端 UI 层的同步状态由 `SyncContext` 统一提供，同步指示灯区分 `pending`（本地 Dexie `syncLog.synced=0` 计数大于 0）和 `success` / `idle`。所有自动触发统一走模块级调度器 `syncScheduler`（`packages/client/src/sync/scheduler.ts`），页面不再人肉接线，见下方"1.6 调度器"。设置页"上次同步"展示时间来自 `STORAGE_KEYS.lastSyncDisplayAt`，纯展示，不参与任何同步判定。

特殊入口：

- `syncPull({mode: 'incremental' | 'repair'})`：手动拉取。`incremental` 用本地读数；`repair` 用 `sinceSeq: 0` 全量，但任何仍有 pending 的本地记录/分类级联整组都不覆盖；已完整且本地更新的 entry 继续保留。
- `syncForceReplace()`：清空本地后按 `sinceSeq: 0` 整库覆盖，同时清空本地 `syncLog`，并用返回的 `latestSeq` 推进读数。
- `getSyncHealth()`：contentHash 深度体检 + 建议；本地 content hash 只 hash `categories`、`time_entries`、`quick_notes`、`tasks`，不覆盖 `tracks` / `track_steps` / `goals` / `goal_layout_pins` / `sessions`，主要作为诊断对照；服务端 `/api/sync/status` 的 `contentHash` 仍是全域 commit hash。公开计数字段仍只返回分类、时间记录和速记数量。
- `syncForcePushToServer()`：确认后把本地核心同步表覆盖到服务器；当前只包含 `categories`、`time_entries`、`settings`、`quick_notes`、`tasks`，不包含任务轨道、`goals`、`goal_layout_pins` 或 `sessions`。目标成员关系属于 `Goal.members`，因此不随 tasks force-push 携带；`Task.sessionId` 随 `tasks` 一起搬运，但 `sessions` 本身不在兜底范围内（见 [todo/at-hand](todo/at-hand.md) 关于悬空 sessionId 的说明）。

## 1.5 实时通道与调度器（已外提）

「什么时候同步」整簇在子文档 [sync/realtime-and-scheduler](sync/realtime-and-scheduler.md)：服务端 SSE 通知通道（`GET /api/sync/stream`、`notifySyncChange`、带 changes 的 bump 及其退化规则）、客户端连接与重连退避、以及所有触发路径收口的模块级 `syncScheduler`（防抖 300ms / max-wait 2s / 失败退避 / 60s 兜底 / 生命周期接线）。

## 2. Push 流程详解（已外提）

客户端 `syncPush` 的日志压缩与 reasonCode 分类处理、409 两种形状，服务端的排序 / 校验 / 备份 / apply / 记账七步，tasks 与 tracks 的语义 `op` 与守卫列，以及 tasks 删除死因归档，见子文档 [sync/push-pull](sync/push-pull.md) §1。

## 3. Pull 流程详解（已外提）

`sinceSeq` 游标语义、分页与逐批推进、客户端六条应用规则、lww 域静默丢弃窗口、tombstone 保留约束，见子文档 [sync/push-pull](sync/push-pull.md) §2。

## 3.5 全量同步兜底（已外提）

force-push 五域差异替换、`/api/data/reset` 的账本保全、五重保护与排障路径，见子文档 [sync/push-pull](sync/push-pull.md) §3。

## 4. 冲突解决

UI 拿到 `SyncConflict[]` 后调 `resolveConflicts(conflicts, resolution)`：

- `keep_local`：什么都不做，下次 push 把本地版本送上去；对 `remoteAction: 'delete'` 等价于下次 push 重新创建。
- `use_remote` + `remoteAction: 'update'`：单 Dexie 事务里用服务器版本覆盖本地，只消费冲突创建时记录的 `sourceLogIds`。
- `use_remote` + `remoteAction: 'delete'`：接受服务器删除并按级联范围处理；若冲突创建后又产生新 pending，则只清理旧冲突日志，不覆盖/删除新的本地主张。

UI 挂起冲突只发生在 manual 域（categories / time_entries）。lww 域（settings / quick_notes / tasks / tracks / track_steps / goals / goal_layout_pins / sessions 等）通常后写赢；但在 push 的 `baseSeq` 重叠或 unknown-base 路径上，服务端 staleGuard 会拒收过期来包，客户端把拒收项列入同步问题并通过回声 pull 接受服务器版本。

<a id="sync-invariants"></a>

## 5. 不变量与约束

1. **客户端写业务表必须同时写 `syncLog`**（同一 Dexie 事务），否则数据丢同步。
2. **服务端任何业务写入必须记账**：写表与 `recordSeq` 同事务。绕过账本的写入对所有设备不可见（e2e helper 播种数据也要遵守）。
3. **`sync_push` 的事务边界是「已应用的那些一起提交」，不是「整批全有或全无」**：validation 拒绝走 409，整批不落库；一旦进入 apply，同批允许出现 `skipped`（stale、孤儿步等），它们在 200 响应里作为 conflict outcome 返回，**不回滚同批其他已应用记录**。普通安全 push 不拍服务端备份，seq 冲突和隐式删除这类危险 push 在事务前创建受保护备份并做备份后账本版本校验。
4. **push 应用顺序由登记簿优先级决定**：由登记簿的 `upsertPriority` / `deletePriority` 决定（见 [服务端 push](sync/push-pull.md#sync-server-push) 与 [sync/domain-registry](sync/domain-registry.md)）。关键依赖示例包括分类父子、entry 引用分类、track 与 step、goal 与 pin；新域的优先级要显式考虑外键依赖。
5. **`updated_at` 由服务器分配**：客户端提交的时间戳不会原样落库；展示"业务发生时间"用业务字段（如 `occurredAt` / `startTime`），不用 `updatedAt`。
6. **服务端 commit hash 必须随写路径失效或刷新**：`recordSeqWithDb` 在同一事务内标 dirty，`/api/sync/status` 惰性重算；reset 完成时立即刷新。它现在只服务诊断，但仍要保持正确。
7. **server 是冲突仲裁者**：用 `baseSeq` 判断快进 / 非重叠合并 / 重叠冲突 / unknown-base；重叠记录按时间戳 staleGuard 拒收过期来包，并用受保护备份记录危险 push 场景。
8. <a id="sync-row-granularity"></a>**同步的粒度是「整行」，不是「改动的字段」**——本条是 [客户端 push](sync/push-pull.md#sync-client-push) 与 [pull](sync/push-pull.md#sync-pull-flow) 两条规则相乘的后果，写代码前必须知道。`syncLog` 只记「哪一行变了」（`SyncLogEntry` 无列信息，`recordSyncLog` 签名里也没有位置放），push 时按 recordId 回读**当前整行**（`engine.ts` 的 `db.table(storeName).get(...)`），服务端 `ON CONFLICT DO UPDATE SET` **除主键 / `created_at` / 无 `op` 时的 `guardedColumns` 外的全部列**。由此产生两个后果：
   - **双向丢失窗口**：设备 A 改了某行并同步成功，设备 B 尚未拉到就对同一行发生任何写入（哪怕只想改一个字段），B 的整行 push 会用它手上的旧值覆盖 A 的改动；同时 [pull](sync/push-pull.md#sync-pull-flow) 的「lww 域本地有未推送日志则跳过远端」会让 B 也永远收不到 A 的那次改动。风险列是非 `guardedColumns` 的全部；具体字段以对应 row mapper 为准。
   - **版本错位会清空新列**：旧客户端不认识新加的字段，push 的 payload 里缺这一项，服务端 zod 默认值会补齐，再经全列 SET 抹掉服务器现值。这是 [全量同步兜底](sync/push-pull.md#sync-full-fallback) 结尾「server / Web / APK 必须同版本发布」在**上行方向**的具体机理，也是 [ADR 0012](../adr/0012-sync-ledger-and-domain-registry.md) 那条部署纪律不能松的原因。
   缓解手段只有既有的两件：`guardedColumns`（黑名单，仅 tasks 完成语义列与 `tracks.status`）与 `op`（布尔授权闸，见 [tasks / tracks 语义 op](sync/push-pull.md#sync-tasks-tracks-op)）。**它们都是窄解法，不是通用防线。**服务端 `routes/sync.test.ts` 用「缺新字段的旧 payload」把本条机理钉成回归测试；客户端所有 `apiFetch` 请求带 `X-TimeData-Client-Build` 头，服务端**只记录不拦截**，供排查覆盖出自哪个构建。

## 6. 错误码处理（客户端侧）

`SyncPushOutcome.reasonCode` 由 `packages/client/src/sync/reason.ts` 的 `classifyReasonCode()` 统一分类：

| reasonCode | 分类 | 客户端处理 |
|---|---|---|
| `applied` | `applied` | 仅出现在 200 响应：已应用并确认日志。 |
| `validated` | `unknown`（防御性） | 仅出现在 409 原子拒绝批的 accepted outcome：只代表通过校验、未落库，绝不能据此确认日志；客户端只看 `status === "accepted"` 决定重试子批。 |
| `missing_payload` / `invalid_shape` / `id_mismatch` | `client_bug` | 标 `synced=1` 停止反复推送；放入 `clientBugIssues` 供诊断。 |
| `archived_category` / `missing_category` / `overlap` / `invalid_time_range` / `foreign_key_failed` | `user_actionable` | 200 响应中保留在 `syncLog`；原子 409 中隔离为死信（`synced=2`），设置页同步摘要提示用户处理。 |
| `stale_change_rejected` / `orphan_step_rejected` | `stale_rejected` | 标 `synced=1` 放弃本地主张；放入同步问题列表，回声 pull 落地服务器权威版本。 |
| `server_version_newer_or_same` | `conflict` | 200 响应中保留，进入冲突/同步问题处理路径；原子 409 中隔离为死信（`synced=2`）。 |
| 未识别值 | `unknown` | 200 响应中保留；原子 409 中隔离为死信，避免未知拒因引发无限重发。 |

**死信隔离（`synced=2`）**：原子 409 中被服务端确定性拒收（非 client_bug / stale）的日志标 `synced=2`——不参与 push、pending 保护和未同步计数，避免每轮同步重复引爆 409 拆批。用户修正记录会产生新的 `synced=0` 日志自然重新入队；`requeueQuarantinedSyncLogs()` 提供手动重新入队出口，`getQuarantinedSyncLogs()` 供诊断读取。死信与 synced=1 同走 `pruneSyncedLogs()` 的 7 天回收窗口。

`SyncPushReasonCode` 是封闭枚举；新增值必须同步更新 shared schema、server validation / resolver 映射、`classifyReasonCode()`、客户端测试和本文档表。**域登记簿同样封闭**：新增域必须同步 shared 配置、server 钩子/映射、客户端 Dexie 表与 pull 分支、静态 `SyncChange` 类型、文档。

<a id="sync-observability"></a>

## 7. 观测与排障（已外提）

同步日志、分段耗时和慢同步取证路径在纵切子文档 [sync/troubleshooting](sync/troubleshooting.md)。母文只保留两条边界：

- Dexie `syncLog` 是客户端待上传队列；`synced=0` 才参与 push，`synced=2` 是死信隔离。
- SQLite `sync_logs` 是服务端运维审计；客户端上报是 best-effort，不能阻塞同步主路径。

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [sync/push-pull](sync/push-pull.md) | push 与 pull 一趟的完整流程、tasks/tracks 语义 op 与守卫列、force-push 与 reset 的账本保全 |
| [sync/domain-registry](sync/domain-registry.md) | shared/server/client 三端同步域登记簿、当前运行时域、新增 LWW / 复合键域 checklist、登记簿测试入口 |
| [sync/realtime-and-scheduler](sync/realtime-and-scheduler.md) | 服务端 SSE 通知通道与 bump 载荷、客户端连接/重连退避、模块级 `syncScheduler` 的触发原因·防抖·退避·生命周期接线 |
| [sync/troubleshooting](sync/troubleshooting.md) | Dexie / SQLite 两套同步日志、分段耗时、慢同步排查入口和取证最小集 |
