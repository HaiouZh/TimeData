---
type: evergreen
title: 同步机制
covers:
  - packages/shared/src/syncDomains.ts
  - packages/shared/src/entitySchemas.ts
  - packages/server/src/sync/**
  - packages/server/src/db/schema.ts
  - packages/server/src/routes/sync.ts
  - packages/server/src/routes/syncLog.ts
  - packages/client/src/sync/**
  - packages/client/src/lib/syncStream.ts
  - packages/client/src/hooks/useSync.ts
  - packages/client/src/contexts/SyncContext.tsx
  - packages/client/src/lib/api.ts
  - packages/shared/src/types.ts:SyncChange
  - packages/shared/src/schemas.ts
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
last-reviewed: 2026-06-24
---

# 同步机制

> 同步是这个项目最复杂的部分。这份文档讲：账本模型、域登记簿、流程、冲突解决规则、`SyncPushReasonCode` 含义、关键约束。
> Backup 是另一回事，见 [`backup.md`](./backup.md)。架构决策见 [`ADR 0012`](../adr/0012-sync-ledger-and-domain-registry.md)。

## 0. 账本模型与域登记簿

同步内核是一个**账本模型**：

- 服务器 SQLite `sync_seq` 表是只增不减的权威变更序列（账本）。每笔成功写入（任何域、任何入口）都追加一行并获得递增编号。
- 每台设备只持有一个读数：`localStorage.timedata_last_synced_seq`。追数据只有一种问法："`sinceSeq` 之后给我"。
- `updated_at` / `deleted_at` 由服务器在记账时分配（`resolver.ts` 的 `serverNow`）；客户端时钟只作展示参考。排序权威是账本编号，设备时钟漂移不影响同步正确性。

**域登记簿**决定系统认识哪些数据类型：

| 层 | 文件 | 内容 |
|---|---|---|
| shared | `packages/shared/src/syncDomains.ts` | `SYNC_DOMAINS`：每域的 `table`、`dataSchema`（zod）、`upsertPriority` / `deletePriority`、`conflictPolicy`（`lww` / `manual`）、`countsInStatus`。`SyncChangeSchema` 运行时校验由它生成。 |
| server | `packages/server/src/sync/domains.ts` | `SERVER_SYNC_DOMAINS`：每域可选钩子 `validate` / `crossValidate` / `apply` + 必选 `readRecord`；无 `apply` 钩子的域走通用 LWW 路径（`lww: { idColumn, toRow }`）。 |

当前十五个运行时域：`categories`（manual，钩子承载层级校验与级联删除）、`time_entries`（manual，钩子承载未来时间拒绝、重叠覆盖）、`settings`（lww，零钩子，`countsInStatus=false`，承载睡眠分类、打点分类、底部导航可见入口等 UI 偏好）、`quick_notes`（lww，零钩子）、`tasks`（lww，零钩子，`countsInStatus=false`）、`tracks`（lww，`countsInStatus=false`）、`track_steps`（lww，`countsInStatus=false`）、`goals`（lww，`countsInStatus=false`，目标层）、`goal_layout_pins`（lww，`countsInStatus=false`，目标图用户钉点，复合键域）、`health_charts`（lww，健康统计页视图块配置），以及 5 个健康数据域 `health_heart_rate` / `health_hrv` / `health_sleep` / `health_stress` / `runs`（均 lww、零钩子、`countsInStatus=false`，走通用 LWW 路径）。

> 客户端登记簿 `CLIENT_SYNC_DOMAINS`（`packages/client/src/sync/clientDomains.ts`）在 `table`/`storeName`/`schema` 之外，还给每域声明一个 **`backup` 角色**（`core`/`bundled`/`excluded`），驱动完整备份的导出/校验/恢复——那是 Backup 的关注点，详见 [`backup.md`](./backup.md)，不影响同步语义。同一份 `storeName + schema` 还驱动客户端本地 schema 归一 pass（启动时清理 IndexedDB 里不符合当前 shared schema 的本地形状），归一保留 `updatedAt`、不写 `syncLog`、不改同步语义。`taskNeedsApply` 用 `TaskSchema` 投影后深比较，本地孤儿字段不再触发多余 apply。

**新增一个纯 LWW 域的全部成本**：shared 登记一行 + server 写 `lww` 映射和 `readRecord` + 客户端 Dexie 表与 pull 应用分支。校验、排序、写入、记账、seq 补差、墓碑、SSE 实时下发全部白捡。任务轨道和目标层都是这个模式：`tracks.upsertPriority=70/deletePriority=71`，`track_steps.upsertPriority=71/deletePriority=70`，`goals.upsertPriority=72/deletePriority=72`。复合键 LWW 域还要补 shared recordId helper、client `keyOf`、server `identity` / custom apply/read，以及 `backfillMissingSeq()` 的行级 recordId 生成规则，不能靠 payload.id 或单列 pk；`goal_layout_pins.upsertPriority=73/deletePriority=73` 是第一例。验收证明见 `packages/server/src/sync/fake-domain.e2e.test.ts`、`tracks-domain.e2e.test.ts`、`goals-domain.e2e.test.ts` 与 `goal-layout-pins-domain.e2e.test.ts`。

**登记簿是封闭的**：加域必须改代码、过测试。静态类型 `SyncChange`（`types.ts` 手工判别联合）与运行时 schema（登记簿生成）必须同步修改；`health_charts`、`tracks`、`track_steps` 都已有静态分支。

## 1. 整体流程

客户端入口是 `regularSync()`（`packages/client/src/sync/engine.ts`）。同一 JS context 内如果已有一次 `regularSync()` 尚未结束，新的调用会复用进行中的 promise；这只去重同浏览器上下文里的快速重复触发，不是跨 tab leader election。

```
1. 本地未同步计数 + GET /api/sync/status 取云端 latestSeq
2. unsyncedCount=0 且 latestSeq <= 本地读数：no-op（不 push、不 pull、不创建备份）
3. unsyncedCount=0 但云端账本更新：先创建本地自动备份，再 syncPullSinceSeq() 补差
4. unsyncedCount>0：先创建本地自动备份，再 syncPush()（合并、压缩、带分类依赖），然后 syncPullSinceSeq()
5. resolveConflicts()（UI 决定）keep_local 还是 use_remote
6. reportToServer() 往服务器写一条 sync_logs 摘要（best-effort）
```

no-op 判定只比较账本读数，不算哈希、不数行数、不拉快照。`contentHash` 降级为诊断工具：`getSyncHealth()`（设置页同步健康诊断）仍用它做本地与云端的深度体检。

客户端请求统一走 `apiFetch()`（`packages/client/src/lib/api.ts`）：它负责拼接 API 根地址、附带 Bearer Token、保留 API 错误响应 JSON，并默认在 15 秒后中止网络请求；全量拉取可在调用处设置 `timeoutMs: 30_000`。调用方传入的 `AbortSignal` 会和内部超时信号合并；成功响应体如果不是合法 JSON，会抛出包含 URL 与响应片段的人类可读错误；204 / 空 body 视为 `undefined`。

客户端 UI 层的同步状态由 `SyncContext` 统一提供，同步指示灯区分 `pending`（本地 Dexie `syncLog.synced=0` 计数大于 0）和 `success` / `idle`。自动触发分两类：首次进入时间轴页 `syncIfStale()` 30 秒节流兜底；写入成功后 `syncAfterWrite()` 1.5 秒防抖。时间轴兜底同步如果在连通性探测阶段失败，会安排一次不依赖本地待上传队列的立即重试，避免红灯停住且只能靠切页重新触发；写入防抖仍只在本地存在未同步日志时发起。设置页"上次同步"展示时间来自 `STORAGE_KEYS.lastSyncDisplayAt`，纯展示，不参与任何同步判定。

特殊入口：

- `syncPull({mode: 'incremental' | 'repair'})`：手动拉取。`incremental` 用本地读数；`repair` 用 `sinceSeq: 0` 全量，但**已完整且本地更新的 entry 不覆盖**。
- `syncForceReplace()`：清空本地后按 `sinceSeq: 0` 整库覆盖，同时清空本地 `syncLog`，并用返回的 `latestSeq` 推进读数。
- `getSyncHealth()`：contentHash 深度体检 + 建议；本地 content hash 与服务端 commit hash 都会受 `tasks`、`tracks`、`track_steps`、`goals`、`goal_layout_pins` 等同步域变化影响，但 `/api/sync/status` 的公开计数字段仍只返回分类、时间记录和速记数量。
- `syncForcePushToServer()`：确认后把本地核心同步表覆盖到服务器；当前只包含 `categories`、`time_entries`、`settings`、`quick_notes`、`tasks`，不包含健康原始数据、`health_charts`、任务轨道、`goals` 或 `goal_layout_pins`。目标成员关系属于 `Goal.members`，因此不随 tasks force-push 携带。

## 1.5 前台 SSE 实时通知通道

服务端提供只读接口 `GET /api/sync/stream`（`packages/server/src/routes/sync.ts`）。挂在 `/api/*` 鉴权之后，客户端 fetch 流式读取、header 带 token。连接成功立刻发 `event: hello`（`{"latestSeq": ...}`），之后每 30 秒一条 `: ping` 注释心跳。

`packages/server/src/sync/notifier.ts` 维护进程内连接集合。`/api/sync/push`、`/api/sync/force-push`、CLI `/api/entries` 创建、agent `POST /api/quick-notes` 投递、agent `POST /api/agent/tasks/:id/status` 回写任务状态或 tags 成功后，事务结束调用 `notifySyncChange(getLatestSeq())` 广播 `event: bump`（只含 `{latestSeq}`，不含业务数据）。客户端收到 bump 后复用普通同步链路；SSE 只提示"账本到 #N 了"。

客户端连接逻辑在 `packages/client/src/lib/syncStream.ts`：前台可见、云同步开启且已配置 API 地址时启动；断开按 1s/2s/4s 退避封顶 30s 带抖动。`hello` / `bump` 统一处理：远端 `latestSeq <= 本地读数` 视为回声忽略；更高则 200ms 防抖触发一次 `sync()`。设置页连接灯读 `SyncContext.connection`。

通知器与 force-push token 一样是单进程内存状态；`SERVER_REPLICAS>1` 时启动告警，真正多实例前需要 Redis pub/sub 等跨实例转发。

## 2. Push 流程详解

### 2.1 客户端做了什么（`syncPush`）

1. 从 Dexie `syncLog` 取所有未同步日志（`synced=0`）。
2. **按 `tableName:recordId` 分组压缩**（`compactSyncLogs`）：同一记录多次改只保留最后一条；`create+...+delete` 整组省略不发送但本地标已同步；`create+update` 合并为 `create`。
3. 从业务表读最新数据填进 `change.data`（delete 除外）。
4. **附带分类依赖**（`categoryDependencyChangesForEntry`）：push 的 entry 引用的分类还没在服务器上时，把分类（和它的父分类）一起塞进 changes，避免"先 push entry 因分类不存在被拒"的死锁。
5. POST `/api/sync/push`，请求体 `{ changes, baseSeq }`。`baseSeq` 来自本地读数，服务端用它判断快进、非重叠合并还是 non-fast-forward 本地覆盖。入口先过 `SyncPushRequestSchema`，不合法返回 400 `invalid_request`。
6. 服务器返回后按 `SyncPushOutcome.reasonCode` 分类处理本地 syncLog：`applied` 和 `client_bug` 类标已同步，`user_actionable` / `conflict` / `unknown` 保留。HTTP 409 时 `apiFetch` 保留 JSON body，同样按 outcomes 分类。
7. `pushIssues` / `clientBugIssues` / `userActionableIssues` 暴露给 UI / 诊断。

### 2.2 服务端做了什么（`/api/sync/push`）

1. `orderPushChanges`（登记簿优先级驱动）：**categories upsert（组内父子拓扑排序）→ time_entries → settings → quick_notes → tasks → 健康域 → health_charts → tracks → track_steps → goals → goal_layout_pins**，delete 也按各域 `deletePriority` 进入同一排序。保证 entry 引用的分类先到位、轨道步骤父先建子先删、目标钉点晚于目标主表。
2. `validateSyncChanges`（登记簿驱动，见 2.3）。
3. **任意一条 invalid 就整体拒绝**：返回 409 + 全部 outcomes，不写库、不备份。
4. 根据 `baseSeq` 分析：`unknown_base` / `fast_forward_push` / `merge_non_overlapping` / `local_wins_non_fast_forward`，对应创建（受保护）服务端备份，语义与字段同前（`overriddenRecordIds`、`backupId`、`seqAnalysis` 等）。
5. 在一个 SQLite 事务里逐条 `applyChange`（见 2.4）。每条成功写入都追加 `sync_seq` 并把 commit hash 标 dirty。
6. 写一条 server-side `sync_logs` 摘要，事务后 `notifySyncChange(getLatestSeq())`。

### 2.3 校验规则（`validateSyncChanges`，登记簿驱动）

每条 change 依次过三层：

1. **基础形状**：`recordId` / `timestamp` / `action` 缺失 → `invalid_shape`；表名不在登记簿 → `invalid_shape`。
2. **通用校验**（`validateGenericChange`，全域一致）：delete 直接接受；upsert 要求有 payload（`missing_payload`）、payload 过域 `dataSchema`（`invalid_shape`，entry 的 `endTime <= startTime` 映射为 `invalid_time_range`）、payload identity === recordId（`id_mismatch`）。普通域的 identity 是 `payload[idColumn]`；复合键域可由 server `identity` hook 计算。时间字段由 schema 收紧为严格 `YYYY-MM-DDTHH:mm:ss.sssZ`。
3. **域钩子**：
   - `time_entries.crossValidate`：同批 entries 互相重叠 → `conflict / overlap`。
   - `time_entries.validate`：`endTime` 不能晚于当前 UTC（`invalid_time_range`）；分类必须存在（`missing_category`）且未归档（`archived_category`）。
   - `categories.validate`：不能自引用、只支持两级（`invalid_shape`）；父分类必须存在（`missing_category`，同批 push 的算存在）。
   - `goal_layout_pins.validate`：delete 时也必须能 decode 复合 `recordId`。
   - `settings` / `quick_notes` / `tasks` / `tracks` / `track_steps` / `goals`：无钩子，通用校验即全部。

### 2.4 写入规则（`applyChange`，登记簿驱动）

`applyChange` 按登记簿分发：有 `apply` 钩子走钩子，否则走通用 LWW 路径。**所有路径的 `updated_at` / `deleted_at` 都取服务器当前时间 `serverNow`，不取 `change.timestamp`**。

- **通用 LWW**（settings、quick_notes、tasks、tracks、track_steps、goals、health_charts、健康数据域及未来的零钩子域）：delete = 真删除 + tombstone upsert；upsert = 删 tombstone + `INSERT ... ON CONFLICT DO UPDATE`（列来自域的 `toRow()`，主键与 `created_at` 只在插入时写）。`track_steps.track_id` 不建 SQL 外键，轨道删除必须由客户端或未来服务端受控入口显式发每条步骤删除。
- **复合键 LWW**（`goal_layout_pins`）：语义仍是 LWW，但不能走单列主键通用 SQL。server 用 `identity` 从 payload 算 `recordId`，custom apply/read 按 `(goal_id,node_kind,node_id)` 读写，delete 仍真删除 + tombstone。
- **categories 钩子**：delete = 级联删除目标分类、后代分类与关联 entries，每条都写 tombstone + delete seq；upsert 正常写入。
- **time_entries 钩子**：upsert 前先删除与该记录时间段重叠的旧远端记录（写 tombstone + delete seq，outcome 带 `overriddenRecordIds` 和 `backupId`，对应备份标受保护 `local_override_overlap`）；分类不存在时 skip 并带结构化 `skipReason`。
- 只有 `status === "applied"` 的变更才记账（skipped 不占 seq）。

## 3. Pull 流程详解（严格 seq 补差）

`/api/sync/pull` 行为：

- 入参 `{ sinceSeq: number | null }`，`SyncPullRequestSchema` 校验：必须是有限非负整数或 `null`；缺字段、负数、小数、Infinity、类型错都返回 400 `invalid_request`。**timestamp cursor（`since` / `lastSyncedAt`）已退役，提交会因缺少 `sinceSeq` 被拒**。
- `sinceSeq: 0` 与 `null` 等价 = 全量。
- 服务端按 `sync_seq` 找出 cursor 后每个 `table_name + record_id` 的**最新**变更（同一记录改 5 次只回最后状态）：delete → 读 tombstone 组成 delete change；其他 → 调域 `readRecord` 读当前行。响应带 `latestSeq`。
- 客户端用 `SyncPullResponseSchema` 校验响应；不合法抛错不写本地。
- 应用完后 `advanceSeqCursor(response)` 推进本地读数。

客户端应用规则（`syncPullSinceSeq()`，普通同步路径）：

- 本地不存在 → 直接写入；delete tombstone 对本地不存在的记录是 no-op。
- 本地存在 + `updatedAt` 相同 → 幂等跳过。
- 本地存在 + `updatedAt` 不同 + 有未同步本地修改 → **manual 域**（categories / time_entries）挂起为 `SyncConflict`；**lww 域**（settings / quick_notes / tasks）跳过远端，本地待推送版本获胜，不进冲突 UI。
- 本地存在 + `updatedAt` 不同 + 无本地修改 → 直接覆盖（自己 push 后回拉的服务器分配时间戳也走这条，幂等无害）。
- 远端 delete + 本地同 record（或分类级联影响范围内）有未同步 `syncLog` → 挂起为 `SyncConflict { remote: null, remoteAction: 'delete' }`，不删本地。
- 远端 delete + 本地无 pending → 直接删除；分类删除级联后代分类和关联 entries。

`syncPull({mode:'repair'})` 是修复模式：`sinceSeq: 0` 全量，但已完整且本地更新的 entry 不覆盖；按服务器状态直接应用 delete，不产生冲突挂起（挂起保护只在普通同步的 `syncPullSinceSeq()` 生效）。

**tombstone 保留约束**（沿用 [ADR 0006](../adr/0006-sync-tombstone-retention.md)）：`sync_tombstones` 与 `sync_seq` 都不按 TTL 自动清理。长期离线客户端持有旧读数，提前清账会导致已删除记录被当作本地独有数据重新 push。安全清理必须同时满足：知道所有活跃客户端水位、有全量修复兜底、有人工确认。

## 3.5 全量同步兜底

全量同步只允许用户手动触发，不自动执行。

| 接口 | 作用 |
|---|---|
| `GET /api/sync/status` | 返回公开业务计数（分类、时间记录、速记）、最新更新时间、`contentHash`、`latestSeq`、服务器时间；`contentHash` / `latestSeq` 仍受 tasks 等所有同步域影响 |
| `POST /api/sync/force-push/prepare` | 生成短时确认 token，返回当前服务端摘要 |
| `POST /api/sync/force-push` | token + 短语 `OVERWRITE_SERVER` 正确时，用客户端核心同步表覆盖服务器 |

force-push 语义不变：shared schema 校验 → 跨记录业务校验（分类、记录、速记、任务 ID 不重复；分类不自引用不三级；父分类与记录分类存在；时间段不互相重叠）→ 先 `createServerBackup('sync_force_push')` → 单事务清空 `sync_tombstones` / `sync_seq` / `categories` / `time_entries` / `quick_notes` / `tasks`，有 `settings` 载荷时也清空 `settings`，然后导入这些核心表 → 刷新 commit hash → 写审计日志 → `notifySyncChange`。健康原始数据、`health_charts`、`tracks`、`track_steps`、`goals` 与 `goal_layout_pins` 当前不在 force-push 请求、校验和导入范围内；tasks payload 不携带目标归属字段。确认 token 为进程内 Map、TTL 5 分钟、一次性消费；多实例限制同前。

五重保护（诊断、短时 token、确认短语、最终确认、服务端备份）与设置页流程不变。客户端连续非网络同步失败达 3 次只提示进入诊断，不自动全量。

排障路径：`/api/health` 失败查地址/HTTPS/反代；`/api/sync/status` 404 查服务器版本；401/403 查 token。**注意：旧版客户端在新服务器上 `/api/sync/pull` 会 400**——server / Web / APK 必须同版本发布（见 ADR 0012 部署注意）。

## 4. 冲突解决

UI 拿到 `SyncConflict[]` 后调 `resolveConflicts(conflicts, resolution)`：

- `keep_local`：什么都不做，下次 push 把本地版本送上去；对 `remoteAction: 'delete'` 等价于下次 push 重新创建。
- `use_remote` + `remoteAction: 'update'`：单 Dexie 事务里用服务器版本覆盖本地，并把同记录未同步 `syncLog` 标 `synced=1`。
- `use_remote` + `remoteAction: 'delete'`：接受服务器删除，删除本地记录与 pending log；分类删除按级联范围处理。

冲突只发生在 manual 域（categories / time_entries）。lww 域（settings / quick_notes / tasks / tracks / track_steps / goals / goal_layout_pins 等）后写赢，自动解决。

## 5. 不变量与约束

1. **客户端写业务表必须同时写 `syncLog`**（同一 Dexie 事务），否则数据丢同步。
2. **服务端任何业务写入必须记账**：写表与 `recordSeq` 同事务。绕过账本的写入对所有设备不可见（e2e helper 播种数据也要遵守）。
3. **服务端 `sync_push` 是原子事务**：要么整批写入 + 备份，要么完全不动。
4. **push 应用顺序由登记簿优先级决定**：categories upsert → time_entries → settings → quick_notes → tasks → categories delete。新域的优先级要考虑外键依赖。
5. **`updated_at` 由服务器分配**：客户端不要依赖自己提交的时间戳会原样落库；展示"业务发生时间"用业务字段（如 `occurredAt` / `startTime`），不用 `updatedAt`。
6. **服务端 commit hash 必须随写路径失效或刷新**：`recordSeq` 标 dirty，`/api/sync/status` 惰性重算；force-push / reset 立即刷新。它现在只服务诊断，但仍要保持正确。
7. **server 是冲突仲裁者**：用 `baseSeq` 判断快进 / 非重叠合并 / 本地覆盖，并用受保护备份记录本地覆盖场景。

待办域的重复规则、tags、排序、完成状态，以及子任务（独立 `Task` 行，靠 `parentId` 指向 root）的 create/update/delete、重复完成衍生的 occurrence children 快照与 template children reset，都只是普通 `tasks/create`/`tasks/update`/`tasks/delete` 的 LWW change：客户端 helper 通过既有 Dexie transaction 写 `tasks` + 本地 `syncLog`，授权 agent 回写（含 `note` 建 child）构造 change 后走 `applyChange()` + `sync_seq` + SSE 通知。它们**不新增同步域、不扩展 `SyncChange` 联合、不动 `SyncPushReasonCode` 与登记簿条目数**，也不改变 `tasks` 仍是通用 LWW 域的服务端契约。`parentId` 的一层结构约束**只在 force-push 全量快照兜底校验**（`forcePushValidation`：自引用 / 缺失父 / 二层嵌套三种负样本），普通增量 push 故意不挡（依赖客户端 helper，单用户威胁模型取舍）；字段语义与展示桶见 [todo](todo.md)。

## 6. 错误码处理（客户端侧）

`SyncPushOutcome.reasonCode` 由 `packages/client/src/sync/reason.ts` 的 `classifyReasonCode()` 统一分类：

| reasonCode | 分类 | 客户端处理 |
|---|---|---|
| `applied` | `applied` | 标记对应 Dexie `syncLog` 为 `synced=1`。 |
| `missing_payload` / `invalid_shape` / `id_mismatch` | `client_bug` | 标 `synced=1` 停止反复推送；放入 `clientBugIssues` 供诊断。 |
| `archived_category` / `missing_category` / `overlap` / `invalid_time_range` / `foreign_key_failed` | `user_actionable` | 保留在 `syncLog`；设置页同步摘要提示用户处理。 |
| `server_version_newer_or_same` | `conflict` | 保留，进入冲突/同步问题处理路径（兼容保留原因码，主路径已不产生）。 |
| 未识别值 | `unknown` | 保留，避免静默丢弃未来新增原因码。 |

`SyncPushReasonCode` 是封闭枚举；新增值必须同步更新 shared schema、server validation / resolver 映射、`classifyReasonCode()`、客户端测试和本文档表。**域登记簿同样封闭**：新增域必须同步 shared 配置、server 钩子/映射、客户端 Dexie 表与 pull 分支、静态 `SyncChange` 类型、文档。

## 7. 同步日志

两套独立的"同步日志"：

| 表 | 在哪 | 作用 |
|---|---|---|
| Dexie `syncLog` | 客户端 IndexedDB | 待同步队列；`synced=0/1`；未同步项才会被 push |
| SQLite `sync_logs` | 服务端 | 运维审计；记录每次 push/pull 的摘要 |

客户端每次 `regularSync` 完成调 `reportToServer`（best-effort）。主路径动作名：`push`、`pull_since_seq`、`pull_seq_catchup`（无待上传时的补差）、`conflict`。`/api/admin/sync` 读取最近 50 条服务端 `sync_logs`。客户端 cursor key 集中在 `packages/client/src/db/index.ts`（`LAST_SYNCED_SEQ_KEY`），`resetSyncCursors()` 清理读数并顺手清理已退役的 `timedata_last_synced` / `timedata_legacy_snapshot_sync`。

## 8. 改这块代码前的清单

- [ ] 先跑 `packages/server/src/sync/` 全部测试与 `packages/client/src/sync/engine.test.ts`，覆盖很全。
- [ ] 跨 client/server 改动后跑 `pnpm --filter @timedata/client test:e2e`（`sync-roundtrip.e2e.test.ts`）。
- [ ] **加新域**：shared `syncDomains.ts` 登记 → server `domains.ts` 写 `lww` 映射 + `readRecord`（复杂域加钩子）→ `types.ts` 扩展 `SyncChange` 判别联合 → 客户端 Dexie 表 + engine pull 分支 → backup 角色（`core` / `bundled` / `excluded`）与 force-push 是否纳入当前格式契约 → 参照 `fake-domain.e2e.test.ts` 写全链路测试 → 更新本文档第 0 节、[data-model](data-model.md)、[backup](backup.md) 与对应域文档。复合键域还必须提供 shared recordId helper、client `keyOf`、server `identity` / custom apply/read，以及 `backfillMissingSeq()` 的行级 `recordId` 生成规则，不能靠 payload.id 或单列 pk。不要让运行时登记簿、静态 `SyncChange` 联合和客户端域登记簿分叉。
- [ ] 改 `SyncPushReasonCode`：shared schema、server validation/resolver、`classifyReasonCode()`、本文档第 6 节、`data-model.md`。
- [ ] 改 `regularSync` 主路径：先测 seq no-op、pull-only 补差、push + pull 三条路径。
- [ ] 改服务端写路径：确认写表与 `recordSeq` 同事务、commit hash 标 dirty、事务后 `notifySyncChange`。
- [ ] 改 shared 实体 schema：客户端按需升 `SCHEMA_NORMALIZATION_VERSION` 清洗老数据；服务端按需 `ensure*Columns()` 或 `dropColumnsIfExist()`；加字段 server 先行、减字段 shared 先行物理删列最后。归一不写 `syncLog`，也不替代服务端权威校验。
- [ ] 验 full sync fallback：`/api/health` → 带鉴权 `/api/sync/status` → 测试库走同步健康诊断和 force-push prepare；不要在生产库执行最终覆盖。
- [ ] 真实数据回放：把 `timedata.backup` 放到 `docs_local/fixtures/` 后跑 `packages/server/src/__tests__/e2e/real-data-replay.test.ts`。
