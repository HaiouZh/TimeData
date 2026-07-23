---
type: evergreen
title: 同步机制
covers:
  - packages/server/src/sync/backup.ts
  - packages/server/src/sync/conflict.ts
  - packages/server/src/sync/forcePushValidation.ts
  - packages/server/src/sync/notifier.ts
  - packages/server/src/sync/order.ts
  - packages/server/src/sync/resolver.ts
  - packages/server/src/sync/seq.ts
  - packages/server/src/sync/state.ts
  - packages/server/src/sync/validation.ts
  - packages/server/src/db/schema.ts
  - packages/server/src/routes/sync.ts
  - packages/server/src/routes/syncLog.ts
  - packages/client/src/sync/changes.ts
  - packages/client/src/sync/conflicts.ts
  - packages/client/src/sync/engine.ts
  - packages/client/src/sync/reason.ts
  - packages/client/src/sync/scheduler.ts
  - packages/client/src/lib/syncStream.ts
  - packages/client/src/sync/phaseTimings.ts
  - packages/client/src/hooks/useSync.ts
  - packages/client/src/hooks/useAppHideFlush.ts
  - packages/client/src/contexts/SyncContext.tsx
  - packages/client/src/lib/api.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/taskCompletion.ts
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
  - packages/shared/src/schemas.ts
  - packages/shared/src/types.ts:SyncPushOutcome
  - packages/server/src/db/schema.ts
last-reviewed: 2026-07-12
---

# 同步机制

> 同步是这个项目最复杂的部分。这份文档讲：账本模型、域登记簿、流程、冲突解决规则、`SyncPushReasonCode` 含义、关键约束。
> Backup 是另一回事，见 [`backup.md`](./backup.md)。架构决策见 [`ADR 0012`](../adr/0012-sync-ledger-and-domain-registry.md)。

## 0. 账本模型与域登记簿

同步内核是一个**账本模型**：

- 服务器 SQLite `sync_seq` 表是只增不减的权威变更序列（账本）。每笔成功写入（任何域、任何入口）都追加一行并获得递增编号。
- 每台设备只持有一个读数：`localStorage.timedata_last_synced_seq`。追数据只有一种问法："`sinceSeq` 之后给我"。
- `updated_at` / `deleted_at` 由服务器在记账时分配（`resolver.ts` 的 `serverNow`）；排序权威是账本编号。客户端提交的 `change.timestamp` 不落库，但在 `baseSeq` 冲突记录上用于 staleGuard 时间戳线性化；设备时钟偏差超过 60 秒会在设置页提示用户校准。

**域登记簿**决定系统认识哪些数据类型：shared `SYNC_DOMAINS` 负责运行时 schema、优先级、冲突策略和计数语义；server `SERVER_SYNC_DOMAINS` 负责校验 / 写入 / pull 读回；client `CLIENT_SYNC_DOMAINS` 负责 Dexie store、pull 应用与备份角色。登记簿细节、当前 15 个运行时域、新增普通 LWW 域与复合键域的完整 checklist，见子文档 [sync/domain-registry](sync/domain-registry.md)。

**登记簿是封闭契约**：新增域必须同步 shared 配置、server 钩子/映射、客户端 Dexie 表与 pull 分支、静态 `SyncChange` 类型、backup 角色和文档，不能让运行时登记簿、静态判别联合、客户端登记簿三者分叉。

实体字段演进不等于新增同步域：例如 `Task.weight` 是既有 `tasks` LWW 域的结构化字段，随 `TaskSchema`、Dexie/SQLite 映射、backup/force-push 和 sync pull/push 载荷一起演进，不增加运行时域数量，也不扩展 `SyncPushReasonCode`。

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
6. 成功分支收尾 pruneSyncedLogs()：synced=1 的历史日志按 7 天窗口清理
```

写后阻塞链路因此至多 push + pull 两个网络请求，且无插队时进一步降到仅 push 一个（push 回执带 latestSeq/appliedCount，判定无插队即跳过回声 pull，见 [ADR 0016](../adr/0016-push-latestseq-and-pull-pagination.md)）。主链无前置探活：服务器不可达时由 push/status 请求本身报错走 `setError`（`lib/serverHealth.ts` 仅供诊断场景）。同步前不创建本地快照备份（[ADR 0015](../adr/0015-remove-client-auto-snapshots.md)）。

no-op 判定只比较账本读数，不算哈希、不数行数、不拉快照。`contentHash` 只是诊断工具：`getSyncHealth()`（设置页同步健康诊断）仍用它做本地与云端的深度体检。

客户端请求统一走 `apiFetch()`（`packages/client/src/lib/api.ts`）：它负责拼接 API 根地址、附带 Bearer Token、保留 API 错误响应 JSON，并默认在 15 秒后中止网络请求；全量拉取可在调用处设置 `timeoutMs: 30_000`。调用方传入的 `AbortSignal` 会和内部超时信号合并；成功响应体如果不是合法 JSON，会抛出包含 URL 与响应片段的人类可读错误；204 / 空 body 视为 `undefined`。

客户端 UI 层的同步状态由 `SyncContext` 统一提供，同步指示灯区分 `pending`（本地 Dexie `syncLog.synced=0` 计数大于 0）和 `success` / `idle`。所有自动触发统一走模块级调度器 `syncScheduler`（`packages/client/src/sync/scheduler.ts`），页面不再人肉接线，见下方"1.6 调度器"。设置页"上次同步"展示时间来自 `STORAGE_KEYS.lastSyncDisplayAt`，纯展示，不参与任何同步判定。

特殊入口：

- `syncPull({mode: 'incremental' | 'repair'})`：手动拉取。`incremental` 用本地读数；`repair` 用 `sinceSeq: 0` 全量，但任何仍有 pending 的本地记录/分类级联整组都不覆盖；已完整且本地更新的 entry 继续保留。
- `syncForceReplace()`：清空本地后按 `sinceSeq: 0` 整库覆盖，同时清空本地 `syncLog`，并用返回的 `latestSeq` 推进读数。
- `getSyncHealth()`：contentHash 深度体检 + 建议；本地 content hash 目前只 hash `categories`、`time_entries`、`quick_notes`、`tasks`，不覆盖 `tracks` / `track_steps` / `goals` / `goal_layout_pins`，主要作为诊断对照；服务端 `/api/sync/status` 的 `contentHash` 仍是全域 commit hash。公开计数字段仍只返回分类、时间记录和速记数量。
- `syncForcePushToServer()`：确认后把本地核心同步表覆盖到服务器；当前只包含 `categories`、`time_entries`、`settings`、`quick_notes`、`tasks`，不包含健康原始数据、`health_charts`、任务轨道、`goals` 或 `goal_layout_pins`。目标成员关系属于 `Goal.members`，因此不随 tasks force-push 携带。

## 1.5 前台 SSE 实时通知通道

服务端提供只读接口 `GET /api/sync/stream`（`packages/server/src/routes/sync.ts`）。挂在 `/api/*` 鉴权之后，客户端 fetch 流式读取、header 带 token。连接成功立刻发 `event: hello`（`{"latestSeq": ...}`），之后每 30 秒一条 `: ping` 注释心跳。

`packages/server/src/sync/notifier.ts` 维护进程内连接集合。`/api/sync/push`、`/api/sync/force-push`、CLI `/api/entries` 创建、agent `POST /api/quick-notes` 投递、agent `POST /api/agent/tasks/:id/status` 回写任务状态或 tags 成功后，事务结束调用 `notifySyncChange(getLatestSeq())` 广播 `event: bump`（只含 `{latestSeq}`，不含业务数据）。客户端收到 bump 后复用普通同步链路；SSE 只提示"账本到 #N 了"。

客户端连接逻辑在 `packages/client/src/lib/syncStream.ts`：前台可见、云同步开启且已配置 API 地址时启动；断开按 1s/2s/4s 退避封顶 30s 带抖动。每次 start 都有独立 generation、AbortController、连接超时与 watchdog，旧 run 收尾不能污染新连接；等待响应头超过 15 秒会中止并走重连。`hello` / `bump` 统一处理：远端 `latestSeq <= 本地读数` 视为回声忽略；更高则经 `shouldPullForBump` 判定后 `syncScheduler.requestSync("bump")`。设置页连接灯读 `SyncContext.connection`。

连接带**心跳看门狗**（`STREAM_WATCHDOG_TIMEOUT_MS=45_000`）：每次收到任何字节（含服务端 30 秒一条的 `: ping` 注释心跳）都重置一个 45 秒定时器；定时器到期说明连接已静默断线但底层 fetch 流未报错，主动 `abort()` 触发既有重连退避路径。`stop()` 会同步清理看门狗定时器。服务端心跳节奏本身零改动。

服务端 stream 先注册 listener，再读取并发送 hello；hello 写出前到达的 bump 暂存在连接内，hello 后若账本确实前进再补发。这样没有“hello 已读旧 seq、listener 尚未注册”的丢事件窗口。

通知器与 force-push token 一样是单进程内存状态；`SERVER_REPLICAS>1` 时启动告警，真正多实例前需要 Redis pub/sub 等跨实例转发。

## 1.6 客户端调度器

所有触发 `regularSync()` 的路径统一收口到模块级单例 `syncScheduler`（`packages/client/src/sync/scheduler.ts`）。它不依赖 React，`SyncContext` 挂载时经 `setExecutor()` 注册一个包装了 `useSync().sync` 的 executor，卸载或云同步关闭时注销（`setExecutor(null)`）。

**触发下沉到写入本身**：`recordSyncLog()`（`engine.ts`）每次成功写入 Dexie `syncLog` 后调用 `syncScheduler.notifyWrite()`；批量写入用新增的 `recordSyncLogs(entries)` helper（同样内部调 `notifyWrite()`）。这意味着任何写 `syncLog` 的路径（包括此前遗漏接线的页面、以及 bootstrap 期 `runMaterialization`）都自动获得写后同步，无需页面显式调用同步函数。

**触发原因（`SyncRequestReason`）**：`write`（写入触发）、`bump`（SSE 提示账本前进）、`resume`（回前台）、`reconnect`（SSE 重连成功且上次同步失败）、`fallback`（60 秒兜底 interval）、`flush`（隐藏前尝试推送）、`startup`（executor 注册时的启动 kick）。`requestSync(reason)` 供上述场景显式调用；`notifyWrite()` 是 `write` 原因的专用入口。

**防抖与硬上限**：每次触发用 300ms trailing 防抖合并突发写入；同时有 2s max-wait 硬上限，避免连续写入无限推迟执行。执行中如果又被新触发拦截，不会打断当前这轮，而是记下待处理原因，等本轮结束后自动补跑一次——补跑的 `waitMs`（executor 收到的 `SyncExecutorMeta.waitMs`）如实累计从首次触发到真正执行的等待时长，不清零重算。

**失败与兜底**：任意执行失败（包括纯 pull）保留 retry-needed，按 1s/2s/4s 指数退避、封顶 60s；429 优先尊重响应 body 或真实 `ApiError.headers` 中的 `Retry-After`。成功、关闭云同步或 executor 换代会清掉旧重试状态。60 秒 fallback 仍只做低频保险：有本地 pending 或 retry-needed 才调度，不在成功路径空转。hidden/pagehide flush 会检查真实 outbox/retry 状态，退避中允许一次隐藏前立即尝试；并发的 outbox 预检单飞且绑定 executor generation，连续 hidden/pagehide 不重复发两轮，旧 generation 的迟到查询也不能给新 executor 排任务。没有 executor 时触发只记脏标记，重新注册时再兑现。

**生命周期接线**（`SyncContext.tsx`）：`useAppResumeRefresh` 回前台时 `requestSync("resume")`；`useAppHideFlush`（`hooks/useAppHideFlush.ts`，监听 `visibilitychange` hidden、`pagehide`、Capacitor 原生 `appStateChange` 的 `!isActive`）在应用隐藏前调 `flushNow()` 尝试立即推送——这是一次普通 fire-and-forget 的 `sync()`，不使用 `navigator.sendBeacon` / fetch keepalive（keepalive 请求体有 64KB 上限，同步 payload 可能超限，取舍是尽力而为而非保证送达）。`useAppResumeRefresh` 的唯一消费方是 `SyncContext`，页面不各自接线回前台刷新。

**与手动同步的关系**：设置页手动"立即同步"按钮直调 `sync()`，不经过 `syncScheduler`；`engine.ts` 的 `regularSyncInFlight` 单飞去重仍然生效，手动触发和调度器触发并发时不会重复跑两轮同步。

## 2. Push 流程详解

### 2.1 客户端做了什么（`syncPush`）

1. 从 Dexie `syncLog` 取所有未同步日志（`synced=0`）。
2. **按 `tableName:recordId` 分组压缩**（`compactSyncLogs`）：同一记录多次改只保留最后一条；`create+...+delete` 整组省略不发送但本地标已同步；`create+update` 合并为 `create`。
3. 从业务表读最新数据填进 `change.data`（delete 除外）。`tasks` 域的完成语义还会把压缩组里时间序最后一条 `op` 带进 change：完成后又改标题时，最后一条日志本身无 `op`，压缩结果仍保留前一条完成 `op`，避免 push 快照失去“有意修改完成字段”的授权。
4. **附带分类依赖**（`categoryDependencyChangesForEntry`）：push 的 entry 引用的分类还没在服务器上时，把分类（和它的父分类）一起塞进 changes，避免"先 push entry 因分类不存在被拒"的死锁。
5. POST `/api/sync/push`，请求体 `{ changes, baseSeq, requestId? }`。`baseSeq` 来自本地读数，服务端用它判断快进、非重叠合并、重叠冲突还是 unknown-base 保守路径。`requestId` 是对冲/重试幂等键（每批 `crypto.randomUUID()`，409 拆出的子批换新 id）：命中服务端 `sync_push_requests` 回放表时直接原样返回首发的状态码与响应体，不重复 apply、不占新 seq；备份竞态 409 与内部 500 不进回放表，详见 [ADR 0020](../adr/0020-sync-push-request-idempotency.md)。入口先过 `SyncPushRequestSchema`，不合法返回 400 `invalid_request`。
6. 服务器 200 返回后按 `SyncPushOutcome.reasonCode` 分类处理本地 syncLog：`applied`、`client_bug` 和 `stale_rejected` 类标已同步；`user_actionable` / `conflict` / `unknown` 保留。HTTP 409 表示整批原子拒绝，accepted outcome 的 reasonCode 为 `validated`、只代表"通过校验"、不能确认日志；客户端把被拒项按类归置（client_bug/stale 标 synced=1，其余隔离为 `synced=2` 死信）后立即重试合法子批，只有重试 200 后才确认。`stale_change_rejected` 会进入 `pushIssues`，但客户端放弃本地主张，随后回声 pull 落地服务器权威版本。
7. `pushIssues` / `clientBugIssues` / `userActionableIssues` 暴露给 UI / 诊断。

### 2.2 服务端做了什么（`/api/sync/push`）

1. `orderPushChanges`（登记簿优先级驱动）：**categories upsert（组内父子拓扑排序）→ time_entries → settings → quick_notes → tasks → 健康域 → health_charts → tracks → track_steps → goals → goal_layout_pins**，delete 也按各域 `deletePriority` 进入同一排序。保证 entry 引用的分类先到位、轨道步骤父先建子先删、目标钉点晚于目标主表。
2. `validateSyncChanges`（登记簿驱动，规则见 [sync/domain-registry](sync/domain-registry.md)）。
3. **任意一条 invalid 就整体拒绝**：返回 409 + 全部 outcomes，不写业务表、`sync_seq`、tombstone 或 SSE；accepted outcome 的 reasonCode 为 `validated`（不是 `applied`），表述 passed validation。
4. 根据 `baseSeq` 与 change 的**完整影响集合**分析：分类删除展开后代分类/关联 entries，时间记录 upsert 展开预计被覆盖的 overlap IDs。普通快进 / 非重叠合并不创建服务端备份；`unknown_base` / `local_wins_non_fast_forward` / 隐式删除会在 apply 前创建受保护备份。备份完成后再次比对 `latestSeq`；期间账本前进则 409 让客户端重试，不用过时分析继续 apply。
5. 在一个 SQLite 事务里逐条 `applyChange`（登记簿驱动，规则见 [sync/domain-registry](sync/domain-registry.md)）。冲突记录按时间戳线性化：`analyzePushBaseSeq` 命中的 `overlappingRecords` 启用 staleGuard，`unknown_base` 全量保守启用；比较基线冻结在本批 apply 开始前，来包 `change.timestamp <=` 当时的服务器现存行 `updated_at` 或 tombstone `deleted_at` 时返回 `stale_change_rejected`，不写库、不占 seq。同批前序变更新产生的 tombstone 不得误伤后序 change。快进和非重叠记录不比时间戳，避免同设备快速连续编辑被服务器分配的 `updated_at` 误拒。每条成功写入都追加 `sync_seq` 并把 commit hash 标 dirty。
6. 写一条 server-side `sync_logs` 摘要，事务后 `notifySyncChange(getLatestSeq())`。
7. 响应带 `latestSeq`（apply 后账本最新号）与 `appliedCount`（本批记账数 = apply 事务前后 `getLatestSeq()` 之差）；客户端据 `latestSeq − baseSeq === appliedCount` 判定无插队、跳过回声 pull（见 [ADR 0016](../adr/0016-push-latestseq-and-pull-pagination.md)）。rejected 的 409 响应同样带这两字段（`appliedCount: 0`）。

登记簿的校验、通用 LWW、复合键 LWW 和 manual 域钩子细节统一维护在 [sync/domain-registry](sync/domain-registry.md)，避免新增域时主流程文档和登记簿文档分叉。

### 2.2.1 tasks / tracks 语义 op

`tasks` 域的 `done` / `completedAt` / `skipped` / `lastDoneAt` / `completedCount` 是完成语义字段，不再允许普通整行快照无条件覆盖。客户端在本地写入时用守卫字段 diff 推导可选 `op`：

- `complete`：`done` 从 false 变 true，或 create 出已完成任务。
- `reopen`：`done` 从 true 变 false。
- `skip`：`skipped` 从 false 变 true，或 create 出 skipped occurrence。
- `amend`：其他完成语义字段有意变化，例如重复规则重锚时重置 `lastDoneAt` / `completedCount`。

`op` 是授权标志，不是服务端重算指令；服务端不会理解 occurrence 业务，只把带 `op` 的 tasks upsert 视为“允许这次快照写完成字段”。`SERVER_SYNC_DOMAINS.tasks.lww.guardedColumns` 将 SQLite 列 `done`、`completed_at`、`skipped`、`last_done_at`、`completed_count` 标为守卫列：无 `op` 的 upsert 在 `ON CONFLICT DO UPDATE SET` 里排除这些列，保留服务器现值；INSERT 分支仍全列写入，因为行不存在时没有现值可保护。

这解决 R2 场景：设备 A 勾选任务并带 `op: complete` 上行后，设备 B 基于旧快照只改标题或排序，即使整行 payload 里仍是 `done=false`，无 `op` 的 update 也只能更新标题/排序，不能把服务器上的完成态翻回。部署顺序为客户端先行、服务端后行：旧客户端遇到新服务端时无 `op` 的勾选无法写入完成字段，但旧客户端的拖拽/改标题也无法误翻完成态；新客户端遇到旧服务端时 `op` 会被旧契约剥离，行为退回旧整行覆盖，不比现状更差。完整决策见 [ADR 0018](../adr/0018-tasks-completion-op.md)。

`tracks.status` 同样是守卫列。`updateTrack` / `setTrackStatus` / agent `PATCH /api/agent/tracks/:id` 只有在状态实际变化时附 `op:{type:"status",at}`；无 op 的 tracks upsert 仍可更新标题、摘要、refs，但不能覆盖服务器上的 `status`。`track_steps` 另有宿主轨道闸：create/update 找不到宿主 track 时返回 `orphan_step_rejected` 并跳过落库；客户端把它归类为 `stale_rejected`，标记本地日志已处理并通过回声 pull 接受服务器权威状态，避免孤儿步骤重复推送。

### 2.2.2 tasks 删除死因归档

`tasks` 的 delete 生效前，`resolver.ts` 在 `DELETE FROM tasks` 之前调 `SERVER_SYNC_DOMAINS.tasks.lww.archiveDelete` 钩子，把即将删除的整行快照 `INSERT` 进只写不读的 `deleted_tasks_archive`（`task_id` / `payload` JSON / `delete_reason` / `deleted_at`）。行不存在（回声删除、重复 delete）时钩子 no-op，不写归档；staleGuard 拒收的 delete 同样不落库不归档。归档不参与同步域、不出现在 pull/push 协议里，纯服务端审计侧写。

`deleteReason` 是可选字段，只有 `tasks` 域的 delete change 承载（`shared/src/schemas.ts` `TASK_DELETE_REASONS`：`user` / `cascade` / `occurrence` / `mirror`，缺省 `unknown`），client `lib/tasks.ts` 各删除调用点在生成 delete 变更时打标，账本与上行组包原样透传到服务端。

### 2.3 记账边界

只有 `status === "applied"` 的变更才追加 `sync_seq`；skipped 不占 seq。所有写入路径的 `updated_at` / `deleted_at` 都由服务端当前时间 `serverNow` 分配，不取 `change.timestamp`。

## 3. Pull 流程详解（严格 seq 补差）

`/api/sync/pull` 行为：

- 入参 `{ sinceSeq: number | null, limit?: number }`，`SyncPullRequestSchema` 校验：`sinceSeq` 必须是有限非负整数或 `null`，`limit`（可选）为正整数；缺 `sinceSeq`、负数、小数、Infinity、类型错都返回 400 `invalid_request`。**游标只认 `sinceSeq`**：`since` / `lastSyncedAt` 等时间戳游标字段不被接受，缺 `sinceSeq` 一律 400。
- `sinceSeq: 0` 与 `null` 等价 = 全量。
- 服务端按 `sync_seq` 找出 cursor 后每个 `table_name + record_id` 的**最新**变更（同一记录改 5 次只回最后状态）：delete → 读 tombstone 组成 delete change；其他 → 调域 `readRecord` 读当前行。响应带 `latestSeq`；带 `limit` 时按去重后 `sync_seq.id` 升序取前 `limit` 条，并返回 `nextSinceSeq`（本批最后一个 seq id，按 seq 前进、不管某条 change 是否被过滤成 null）与 `hasMore`（取到行数 === limit）。不带 `limit` 时全量、`hasMore=false`、`nextSinceSeq` 收敛到 `latestSeq`（见 [ADR 0016](../adr/0016-push-latestseq-and-pull-pagination.md)）。
- 客户端用 `SyncPullResponseSchema` 校验响应；不合法抛错不写本地。
- 客户端 `fetchPullBatches` 带 `limit: PULL_PAGE_LIMIT`（500）循环拉批：每批 apply 后**逐批**把游标推进到 `nextSinceSeq`（**绝不**中途跳 `latestSeq`——中途失败可断点续传、不漏批），`hasMore` 则 `yieldToMainThread()` 让出主线程后继续；全部拉完 `advanceSeqCursor(response)` 收尾到 `latestSeq`（幂等）。日常量小单批等价现状。

客户端每个 pull page 都在一个覆盖 `syncLog` 与本页实际业务 stores 的 Dexie transaction 内重新读取 pending 后 apply；本地写入只能完整发生在事务前或事务后，不会插入 pending 快照与远端覆盖之间。畸形分页（`hasMore=true` 但 `nextSinceSeq` 缺失、不前进或越过 `latestSeq`）直接抛协议错误，保留上一批游标，不允许跳到末尾。

客户端应用规则（`syncPullSinceSeq()`，普通同步路径）：

- 本地不存在 → 直接写入；delete tombstone 对本地不存在的记录是 no-op。
- 本地存在 + `updatedAt` 相同 → 幂等跳过。
- 本地存在 + `updatedAt` 不同 + 有未同步本地修改 → **manual 域**（categories / time_entries）挂起为 `SyncConflict`；**lww 域**（settings / quick_notes / tasks）跳过远端，本地待推送版本获胜，不进冲突 UI。
- 本地存在 + `updatedAt` 不同 + 无本地修改 → 直接覆盖（自己 push 后回拉的服务器分配时间戳也走这条，幂等无害）。
- 远端 delete + 本地同 record（或分类级联影响范围内）有未同步 `syncLog` → 挂起为 `SyncConflict { remote: null, remoteAction: 'delete', sourceLogIds }`，不删本地；分类整树作为一个冲突单元，保护集合跨 pull 分页保持，后代墓碑不能先删一半。
- 远端 delete + 本地无 pending → 直接删除；分类删除级联后代分类和关联 entries。

`syncPull({mode:'repair'})` 是修复模式：`sinceSeq: 0` 全量；仍有 pending 的同记录或分类级联整组不覆盖/不删除，已完整且本地更新的 entry 继续保留。repair 不生成冲突 UI，但不能吞掉尚未同步的本地主张。

**tombstone 保留约束**（沿用 [ADR 0006](../adr/0006-sync-tombstone-retention.md)）：`sync_tombstones` 与 `sync_seq` 都不按 TTL 自动清理。长期离线客户端持有旧读数，提前清账会导致已删除记录被当作本地独有数据重新 push。安全清理必须同时满足：知道所有活跃客户端水位、有全量修复兜底、有人工确认。

## 3.5 全量同步兜底

全量同步只允许用户手动触发，不自动执行。

| 接口 | 作用 |
|---|---|
| `GET /api/sync/status` | 返回公开业务计数（分类、时间记录、速记）、最新更新时间、`contentHash`、`latestSeq`、服务器时间；`contentHash` / `latestSeq` 仍受 tasks 等所有同步域影响 |
| `POST /api/sync/force-push/prepare` | 生成短时确认 token，返回当前服务端摘要 |
| `POST /api/sync/force-push` | token + 短语 `OVERWRITE_SERVER` 正确时，用客户端核心同步表覆盖服务器 |

force-push 是**五个覆盖域的差异替换**：shared schema/跨记录业务校验 → 受保护 server backup → 备份后 `latestSeq` 乐观校验 → 在单事务内把 `categories`、`time_entries`、可选 `settings`、`quick_notes`、`tasks` 的快照转成 create/update/delete changes，经正常 resolver 写业务表、tombstone 与只增 `sync_seq` → 审计 → SSE。父分类删除复用一次服务端级联，不重复生成子分类/entry delete change。全局账本和全域 tombstone 不清空，健康、轨道、目标、目标钉点等非覆盖域数据/历史删除保持原样，旧游标设备可增量收到覆盖域删除。

客户端 force-push 在同一只读 Dexie transaction 内捕获五域快照和当时的 pending 日志 ID；成功后只确认这组 ID。请求期间新增日志和非覆盖域日志必须保留。该路径是用户确认的低频冷路径，允许为差异计算扫描五个覆盖表；普通增量热路径不增加扫描或网络往返。完整决策见 [ADR 0019](../adr/0019-destructive-sync-operations-preserve-ledger.md)。

`POST /api/data/reset` 与一次性 UTC reset 同样不再清空账本：单事务删除全部 15 个同步域，为旧记录写 tombstone + delete seq，再重建默认分类并写 create/update seq；手动 reset 备份期间若账本前进则 409，成功后发 SSE。根分类 delete seq 先于其级联后代，便于分页客户端从第一页建立整树保护。

五重保护（诊断、短时 token、确认短语、最终确认、服务端备份）与设置页流程不变。客户端连续非网络同步失败达 3 次只提示进入诊断，不自动全量。

排障路径：`/api/health` 失败查地址/HTTPS/反代；`/api/sync/status` 404 查服务器版本；401/403 查 token。**注意：旧版客户端在新服务器上 `/api/sync/pull` 会 400**——server / Web / APK 必须同版本发布（见 ADR 0012 部署注意）。

## 4. 冲突解决

UI 拿到 `SyncConflict[]` 后调 `resolveConflicts(conflicts, resolution)`：

- `keep_local`：什么都不做，下次 push 把本地版本送上去；对 `remoteAction: 'delete'` 等价于下次 push 重新创建。
- `use_remote` + `remoteAction: 'update'`：单 Dexie 事务里用服务器版本覆盖本地，只消费冲突创建时记录的 `sourceLogIds`。
- `use_remote` + `remoteAction: 'delete'`：接受服务器删除并按级联范围处理；若冲突创建后又产生新 pending，则只清理旧冲突日志，不覆盖/删除新的本地主张。

UI 挂起冲突只发生在 manual 域（categories / time_entries）。lww 域（settings / quick_notes / tasks / tracks / track_steps / goals / goal_layout_pins 等）通常后写赢；但在 push 的 `baseSeq` 重叠或 unknown-base 路径上，服务端 staleGuard 会拒收过期来包，客户端把拒收项列入同步问题并通过回声 pull 接受服务器版本。

## 5. 不变量与约束

1. **客户端写业务表必须同时写 `syncLog`**（同一 Dexie 事务），否则数据丢同步。
2. **服务端任何业务写入必须记账**：写表与 `recordSeq` 同事务。绕过账本的写入对所有设备不可见（e2e helper 播种数据也要遵守）。
3. **服务端 `sync_push` 是原子事务**：要么整批写入，要么完全不动；409 outcomes 不代表任何记录已应用。普通安全 push 不拍服务端备份，seq 冲突和隐式删除这类危险 push 在事务前创建受保护备份并做备份后账本版本校验。
4. **push 应用顺序由登记簿优先级决定**：categories upsert → time_entries → settings → quick_notes → tasks → categories delete。新域的优先级要考虑外键依赖。
5. **`updated_at` 由服务器分配**：客户端不要依赖自己提交的时间戳会原样落库；展示"业务发生时间"用业务字段（如 `occurredAt` / `startTime`），不用 `updatedAt`。
6. **服务端 commit hash 必须随写路径失效或刷新**：`recordSeqWithDb` 在同一事务内标 dirty，`/api/sync/status` 惰性重算；reset 完成时立即刷新。它现在只服务诊断，但仍要保持正确。
7. **server 是冲突仲裁者**：用 `baseSeq` 判断快进 / 非重叠合并 / 重叠冲突 / unknown-base；重叠记录按时间戳 staleGuard 拒收过期来包，并用受保护备份记录危险 push 场景。

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

## 7. 同步日志

两套独立的"同步日志"：

| 表 | 在哪 | 作用 |
|---|---|---|
| Dexie `syncLog` | 客户端 IndexedDB | 待同步队列；`synced=0/1/2`（0=待上传，1=已同步/已放弃，2=死信隔离）；仅 synced=0 会被 push |
| SQLite `sync_logs` | 服务端 | 运维审计；记录每次 push/pull 的摘要 |

客户端每轮有实际动作的 `regularSync`（补差或 push+pull）发一次 `reportToServer`——fire-and-forget，不 await、不阻塞同步返回，函数自身吞掉一切错误；POST 到 `/api/admin/sync-logs`，因此走 admin 鉴权、admin 限流和 `X-Confirm` 清空确认所在的同一管理命名空间。主路径动作名：`push`、`pull_since_seq`、`pull_seq_catchup`（无待上传时的补差）、`conflict`。`/api/admin/sync` 读取最近 50 条服务端 `sync_logs`。客户端 cursor key 集中在 `packages/client/src/db/index.ts`（`LAST_SYNCED_SEQ_KEY`），`resetSyncCursors()` 清理读数并顺手清理遗留 key `timedata_last_synced` / `timedata_legacy_snapshot_sync`。

**syncLog 卫生**：未同步查询统一走索引（`where("synced").equals(0)` 或 `[tableName+synced]`），不做全表 `.filter()` 扫描——`synced` 用数字（`0|1|2`）正是为可索引而设。synced=1/2 历史行由每轮成功同步收尾的 `pruneSyncedLogs()` 按 7 天窗口清理，防止无界膨胀；no-op 早退分支不清理，保持零写入。两处收尾调用都是 `void pruneSyncedLogs().catch(() => undefined)`——fire-and-forget，清理失败不再算作整轮同步失败，也不占同步窗口。

### 分段耗时观测

`useSync.sync()` 每轮用 `createPhaseRecorder()`（`packages/client/src/sync/phaseTimings.ts`，默认单调时钟 `performance.now`，与 `totalMs` 同源）给 status/push/pull 三个阶段计时——写后路径只有 push/pull，补差路径只有 status/pull；无论成功还是失败，收尾都会落一条 `SyncTimingEntry` 到 localStorage `timedata_sync_phase_timings` 环形缓冲（最多 20 条，最新在前）。`getSyncTimings()` 读取时做逐元素 shape 校验，坏元素丢弃；`phases` 允许携带未知阶段键（值须为有限 number），带 health/backup/report 等旧阶段键的存量数据仍合法、无需迁移。

`SyncTimingEntry` 额外携带三个可选诊断字段，均来自调度器 `SyncExecutorMeta` 与 SSE 连接态：`waitMs`（executor 触发前在调度器里排队的时长，见 §1.6）、`reason`（`SyncRequestReason` 字符串，本轮由谁触发）、`connection`（触发时的 `SyncStreamState`）。三者都做类型校验（number 需有限、string 类型），缺失时按可选字段处理，不影响存量数据兼容性。设置页同步卡片的 `SyncTimingsPanel` 展示最近一次各阶段耗时、p50/p95，以及最新一条的 `waitMs`/`reason`/`connection`。带 push 或补差的那一轮，`reportToServer` 写给服务端的日志会多带一条 `action: "phase_timings"`（detail 是各阶段 ms 的 JSON；report 本身 fire-and-forget，不再计时）。服务端侧，push/pull 各自在 `sync_logs` 的 detail 里记 `timings` 首字段：`push_received` 含 `parseMs`/`validateMs`/`analyzeBackupMs`/`applyMs`/`totalMs`（真实增量，非累计），`push_rejected` 含 `parseMs`/`validateMs`，`pull_returned` 含 `readMs`/`totalMs`。这套观测纯附加，不改变任何同步判定或行为。

## 8. 改这块代码前的清单

- [ ] 先跑 `packages/server/src/sync/` 全部测试与 `packages/client/src/sync/engine.test.ts`，覆盖很全。
- [ ] 跨 client/server 改动后跑 `pnpm --filter @timedata/client test:e2e`（`sync-roundtrip.e2e.test.ts`）。
- [ ] **加新域**：按 [sync/domain-registry](sync/domain-registry.md) 的 checklist 同步 shared/server/client 登记簿、静态 `SyncChange`、backup 角色、force-push 取舍、对应域文档和全链路测试。
- [ ] 改 `SyncPushReasonCode`：shared schema、server validation/resolver、`classifyReasonCode()`、本文档第 6 节、`data-model.md`。
- [ ] 改 `regularSync` 主路径：先测 seq no-op、pull-only 补差、push + pull 三条路径。
- [ ] 改服务端写路径：确认写表与 `recordSeq` 同事务、commit hash 标 dirty、事务后 `notifySyncChange`。
- [ ] 改 shared 实体 schema：客户端按需升 `SCHEMA_NORMALIZATION_VERSION` 清洗老数据；服务端按需 `ensure*Columns()` 或 `dropColumnsIfExist()`；加字段 server 先行、减字段 shared 先行物理删列最后。归一不写 `syncLog`，也不替代服务端权威校验。
- [ ] 验 full sync fallback：`/api/health` → 带鉴权 `/api/sync/status` → 测试库走同步健康诊断和 force-push prepare；不要在生产库执行最终覆盖。
- [ ] 真实数据回放：把 `timedata.backup` 放到 `docs_local/fixtures/` 后跑 `packages/server/src/__tests__/e2e/real-data-replay.test.ts`。

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [sync/domain-registry](sync/domain-registry.md) | shared/server/client 三端同步域登记簿、当前运行时域、新增 LWW / 复合键域 checklist、登记簿测试入口 |
