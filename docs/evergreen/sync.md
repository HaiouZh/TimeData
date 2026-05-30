---
type: evergreen
title: 同步机制
covers:
  - packages/server/src/sync/**
  - packages/server/src/db/schema.ts
  - packages/server/src/routes/sync.ts
  - packages/server/src/routes/syncLog.ts
  - packages/client/src/sync/**
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
last-reviewed: 2026-05-20
---

# 同步机制

> 同步是这个项目最复杂的部分。这份文档讲：流程、冲突解决规则、`SyncPushReasonCode` 含义、关键约束。
> Backup 是另一回事，见 [`backup.md`](./backup.md)。

## 1. 整体流程

客户端入口是 `regularSync()`（`packages/client/src/sync/engine.ts`）。同一 JS context 内如果已有一次 `regularSync()` 尚未结束，新的调用会复用进行中的 promise，不会再次执行 status/push/pull 主流程；这只去重同浏览器上下文里的快速重复触发，不是跨 tab leader election。

```
1. getLocalStatus() + GET /api/sync/status  比较本地与云端 meta 摘要（优先用 `contentHash`，否则退回 count + lastUpdatedAt）
2. 如果 unsyncedCount=0 且摘要一致：推进 `timedata_last_synced_seq` 到 status.latestSeq，返回 no-op（不 push、不 pull、不创建备份）
3. 如果不一致：先创建本地自动备份
4. unsyncedCount=0 时执行 syncPullRecent(7) 做 pull-only repair
5. unsyncedCount>0 时执行 syncPush() 本地未同步变更 → 服务器，再 syncPullRecent(7)
6. resolveConflicts() （UI 决定）keep_local 还是 use_remote
7. reportToServer()   往服务器写一条 sync_logs 摘要（best-effort）
```

普通同步主路径的一致性校验比较业务 meta：优先比较 `contentHash`；如果任一端缺少 `contentHash`，退回比较 `categoryCount`、`entryCount`、`lastUpdatedAt`，并要求本地 `syncLog` 没有未同步记录。服务端 `contentHash` 是持久化在 SQLite `sync_state` 表里的同步内容 commit hash，由 `latestSeq`、分类/记录行数与最新 `updated_at` 轻量摘要计算而来；`/api/sync/status` 直接读取这份状态，缺失或被写路径标记为 dirty 时一次性重算并写回，不再为每次 status 请求读取完整 categories/time_entries 后 JSON 序列化。普通 no-op 同步不会为了校验拉取云端全量快照，也不比较客户端本地自动备份记录或服务端运维日志。no-op 同步不会触发 `/api/sync/push` 或 `/api/sync/pull`，因此也不会产生服务端 `sync_push` 备份；但如果 `/api/sync/status` 返回了更高的 `latestSeq`，客户端会推进本地 `timedata_last_synced_seq`，避免下一次本地 push 使用过旧 `baseSeq`。

客户端请求统一走 `apiFetch()`（`packages/client/src/lib/api.ts`）：它负责拼接 API 根地址、附带 Bearer Token、保留 API 错误响应 JSON，并默认在 15 秒后中止网络请求；全量替换等可能更慢的同步拉取可在调用处设置 `timeoutMs: 30_000`。调用方传入的 `AbortSignal` 会和内部超时信号合并，组件卸载或路由切换取消请求时不会被误报成超时；成功响应体如果不是合法 JSON，会抛出包含 URL 与响应片段的人类可读错误。`apiFetch` 会把 204 / 空 body 的成功响应视为 `undefined`，而不是强制解析 JSON。`apiFetch` 抛出的人类可读字符串来自 `packages/client/src/lib/messages.ts` 集中字符串表，方便后续 i18n。

兼容回退开关是 `localStorage.timedata_legacy_snapshot_sync === "1"`（集中定义在 `packages/client/src/lib/storageKeys.ts` 的 `STORAGE_KEYS.legacySnapshotSync`）：打开后 `regularSync()` 会走旧的 `loadLocalSnapshot()` + `loadCloudSnapshot()` 全量快照比较路径，主要用于 D2 上线后的灰度回滚。旧路径仍会在快照不一致时补齐本地有、云端无且缺失 syncLog 的 create 日志；新 meta 主路径不会做全量云端快照比较，因此 `unsyncedCount=0` 但 meta 不一致时只执行 `syncPullRecent(7)` 作为 pull-only repair。

客户端 UI 层的同步状态由 `SyncContext` 统一提供。`SyncProvider` 包裹在 App 顶层，复用 `useSync` 的同步动作和诊断能力；时间轴页、设置首页和数据设置页共享同一个状态来源。同步指示灯会区分 `pending`（本地 Dexie `syncLog.synced=0` 实时计数大于 0，表示仍有待上传记录）和 `success` / `idle`（本地待上传计数为 0）；这个 pending 状态只来自本地实时计数，不做额外网络探测。自动触发入口包括：首次进入时间轴页，以及新增/编辑/删除记录成功写入本地后；这些自动触发走 30 秒节流，设置页手动同步按钮不受节流影响。被节流挡下的自动触发会在当前 30 秒窗口结束时安排一次单次补推，补推执行前会再次检查本地是否仍有未上传记录。

还有几个特殊入口：

- `syncPull({mode: 'incremental' | 'repair'})`：手动拉取（设置页"立即拉取"）。`repair` 模式忽略 `lastSyncedAt`，从头拉一遍但不覆盖完整且更新的本地记录。
- `syncForceReplace()`：清空本地后整库覆盖（设置页"将本地数据替换为云端数据"），同时清空本地 `syncLog`，并用服务端返回的 `latestSeq` 推进 `timedata_last_synced_seq`，避免后续普通同步用旧 baseSeq 重新推送覆盖前的本地变更；这条全量拉取会给 `/api/sync/pull` 设置 `timeoutMs: 30_000`。
- `getSyncHealth()`：读取本地摘要和 `/api/sync/status`，给出诊断建议。
- `syncForcePushToServer()`：在用户完成确认后，把本地完整数据覆盖到服务器。

## 2. Push 流程详解

### 2.1 客户端做了什么（`syncPush`）

1. **从 Dexie `syncLog` 取所有未同步日志**。新写入使用 `synced=0`，已同步使用 `synced=1`。
2. **按 `tableName:recordId` 分组压缩**（`compactSyncLogs`）：
   - 同一记录在同一次同步内被多次改：只保留最后一条。
   - `create + ... + delete` 的轨迹：整组**省略不发送**（远端从未见过这条记录），但本地日志全部标为已同步。
   - `create + update + ...` 的轨迹：动作改成 `create`，用最新数据。
3. **从业务表读最新数据**填进 `change.data`（除 delete 外）。
4. **附带分类依赖**（`categoryDependencyChangesForEntry`）：如果 push 一条 entry 引用的分类还没在服务器上，把分类（和它的父分类）一起塞进 changes。
5. `regularSync()` 只有在 meta 主路径判断 `unsyncedCount > 0` 时才调用 `syncPush()`；没有未同步日志但 meta 不一致时只做 pull-only repair。
6. `legacy_snapshot_sync` 本地快照修复路径如果发现本地快照里有云端缺失的记录，但本地 `syncLog` 没有对应未同步日志，会先补一条 create 日志，再走同一条 `syncPush()` 路径。这是本地已有数据但 syncLog 丢失时的兜底。
7. POST `/api/sync/push`，请求体 `{ changes: SyncChange[], baseSeq?: number | null }`。`baseSeq` 来自客户端保存的 `timedata_last_synced_seq`，用于让服务端判断这次 push 相对云端是快进、非重叠合并，还是 non-fast-forward 本地覆盖。服务端入口会先用 `SyncPushRequestSchema` 做运行时校验；不符合 `SyncChange` 判别联合契约的请求返回 400 `invalid_request`，不会进入同步校验或写库。
8. 服务器返回 `SyncPushResponse` 后，客户端按 `SyncPushOutcome.reasonCode` 分类处理本地 syncLog：`applied` 和 `client_bug` 类会标为已同步，`user_actionable` / `conflict` / `unknown` 保留未同步，等待用户处理、冲突流程或后续诊断。即使服务器因整批原子校验返回 HTTP 409，`apiFetch` 也会保留 JSON body，`syncPush()` 会读取其中的 `outcomes` 并按同一套分类处理。
9. `syncPush()` 把 `user_actionable`、`conflict`、`unknown` outcomes 暴露为 `pushIssues`，并额外返回 `clientBugIssues` 与 `userActionableIssues` 供 UI/诊断区分处理；设置页同步摘要会优先展示真正失败的 `tableName/recordId`、`reasonCode` 和服务端 message。

> **关键：不止同步日志关心的那条记录，还会同步它的分类依赖**。这是为了避免"先 push entry，因为分类不存在被拒"的死锁。

### 2.2 服务端做了什么（`/api/sync/push`）

1. `orderPushChanges`：**先 category create/update，后 time_entries，最后 category delete**。这保证 entries 引用的分类总是在同一事务里先到位，同时让 entry delete 先于 category delete 落库，避免外键约束失败。
2. `validateSyncChanges`：先做基础形状、payload、分类存在性、时间范围和同批次重叠检查；**不再用“服务器更新时间较新”这一条把普通本地写入挡掉**。`server_version_newer_or_same` 现在只作为兼容的保留原因码，不再是主路径的拒绝条件。
3. **任意一条 invalid 就整体拒绝**：返回 409 + 全部 outcomes，不写库、不备份。
4. 全部 valid 后，先根据 `baseSeq` 分析服务端在该序列之后的变化：
   - `baseSeq == null` → `unknown_base`，按兼容路径普通 push，但同样会创建受保护备份，`reason = unknown_base`，details 记录 `baseSeq`、`cloudAheadCount`、`overlappingRecords` 和 `pushedRecords`。
   - 云端没有更高 seq → `fast_forward_push`。
   - 云端有更高 seq，但不涉及本批 push 的同一记录 → `merge_non_overlapping`。
   - 云端有更高 seq，且涉及本批 push 的同一记录 → `local_wins_non_fast_forward`。
5. 写入前创建服务端备份：普通路径用 `createServerBackup('sync_push')`；`unknown_base` 用 `createServerBackup('sync_unknown_base')`；`local_wins_non_fast_forward` 用 `createServerBackup('sync_local_wins')`，并标记受保护，`reason = local_wins_non_fast_forward`，details 记录 `baseSeq`、`cloudAheadCount`、`overlappingRecords` 和 `pushedRecords`。Server backup manifest 不存在时按空 manifest 处理；其他读取失败会记录 `[backup] failed to read manifest` 后继续返回空 manifest，避免 manifest 损坏阻断同步写入前备份。
6. 在一个 SQLite 事务里逐条 `applyChange` 写入。每条成功写入都会追加 `sync_seq`，客户端下一次 pull 会从响应里的 `latestSeq` 继续。
7. 对 `time_entries` 来说，服务端仍会先删除与本地记录重叠的旧远端记录，再写入本地版本；被覆盖删除的旧记录会写 `sync_tombstones(table_name='time_entries')` 和 `sync_seq(action='delete')`，让其他设备的 seq cursor pull 能拉到删除消息。如果发生时间段覆盖，返回的 outcome 会带 `overriddenRecordIds` 和 `backupId`，对应备份会被额外标成受保护并写入 `reason = local_override_overlap`。`sync_tombstones` 没有固定 TTL 清理规则：当前不会按天数自动删墓碑，是否引入保留策略要单独评估。
8. `applyChange` 返回 skipped 时会带结构化 `skipReason`；`outcomeFromApplyResult()` 优先用它作为 `reasonCode`，不会把所有 skipped 都折叠成 `server_version_newer_or_same`。
9. 写一条 server-side `sync_logs` 摘要（device='server', action='push_received'），并把 `backupId`、`seqAnalysis`、`overriddenRecordIds` 写进去，方便 `/api/admin/sync` 直接读。

### 2.3 校验规则（`validateSyncChanges`）

按以下顺序判断（每条 change 独立）：

1. **基础形状**：`recordId` / `timestamp` / `action` 缺失 → `invalid_shape`。
2. **delete 直接接受**（不再校验内容）。
3. **create/update 没带 data** → `missing_payload`。
4. **字段形状**：每个字段类型对、`isIsoLike` 通过、id 一致 → 否则 `invalid_shape` / `id_mismatch` / `invalid_time_range`。
5. **分类层级**：category 不能 `parentId === id`，且 `parentId` 只能指向顶层分类；自引用或第三级都返回 `invalid_shape`。
6. **时间范围**：entry 的 `endTime` 必须晚于 `startTime`，且不能晚于当前 UTC 时间；未来记录返回 `invalid_time_range`。服务端校验要求 `startTime` / `endTime` 必须通过 `UtcIsoStringSchema`，也就是严格 `YYYY-MM-DDTHH:mm:ss.sssZ`；省略毫秒、offset 形式或非法日历日期都返回 `invalid_shape`。未来时间比较使用 `nowUtcString()` 直接比较 UTC ISO 字符串。
7. **外键**：
   - category 的 `parentId` 必须存在（除非也在本批 push 里）→ `missing_category`。
   - entry 的 `categoryId` 必须存在 + 不能 archived → `missing_category` / `archived_category`。
8. **同批 entries 重叠**：只要这一批 push 里的两条 entry 自己重叠，就返回 `conflict / overlap`。

> 当前校验阶段不再因为“服务器上已有更晚的版本”直接拒绝本地 push；这类本地优先合并改由 `applyChange` 处理。

### 2.4 写入规则（`applyChange`）

校验通过的 change 才会到这里。逻辑很薄：

- categories.delete = 真删除目标分类及后代分类；逐条删除这些分类下的 entries，并为每条被级联删除的 entry 写 `sync_tombstones(table_name='time_entries')` 与 `sync_seq(action='delete')`；为每个被删分类写 `sync_tombstones(table_name='categories')`。
- categories.create/update = INSERT 或 UPDATE，`updated_at` **以 `change.timestamp` 为准**（不是服务器当前时间）。归档分类走 update，把 `is_archived` 写成 1。
- entries.delete = 真删除 + 写 `sync_tombstones(table_name='time_entries')`。
- entries.create/update = 先删除与该记录时间段重叠的旧远端记录，并为这些被覆盖记录写 `time_entries` tombstone 与 delete seq，再 INSERT 或 UPDATE，`updated_at` 同上。

**所以 `updated_at` 的来源是客户端写日志时记录的 `timestamp`**——也就是客户端本机时钟。

**已知问题（待优化）**：

不同设备时钟漂移会直接影响"谁更新"的判定。如果设备 A 时钟比设备 B 慢一小时，A 的最新修改会被服务器当成"过时"而拒绝。

当前没有机制纠正客户端时钟。**待优化方向**包括：
- push 时附带客户端当前时间，服务器用自己的时间替换 `timestamp`，按服务器单调递增分配版本。
- 或保留客户端时间，但拉取时把"服务器收到时间"也带回来作为权威排序键。

> 同步整体设计正在评估优化方案。改这块前先看当前代码、本文长期文档，以及本地-only 的 `docs_local/plans/` 中是否有最新过程计划。

## 3. Pull 流程详解

`/api/sync/pull` 行为：

- 入参 `{ lastSyncedAt?: string | null, since?: string, sinceSeq?: number | null }`。服务端入口先用 `SyncPullRequestSchema` 做运行时校验：时间字段必须是带毫秒和 `Z` 的 UTC ISO 字符串，`sinceSeq` 必须是有限非负整数或 `null`；畸形 JSON、负数、小数、Infinity 或字段类型错误返回 400 `invalid_request`，不会进入拉取逻辑。`sinceSeq` 存在时优先，按 `sync_seq.id > sinceSeq` 拉取；否则走兼容 timestamp cursor：`since` 优先，其次 `lastSyncedAt`，再不济 `1970-01-01`。
- 客户端收到响应后用 `SyncPullResponseSchema` 做运行时校验；不符合 `SyncChange` 判别联合契约的响应会抛出 `Invalid /api/sync/pull response`，不会写入本地 Dexie。
- seq cursor 路径会按 `sync_seq` 找出 cursor 后每个 `table_name + record_id` 的最新变更，再读取当前业务表或 tombstone 组成 `SyncChange[]`，并在响应中返回 `latestSeq`。
- timestamp cursor 路径拉取 `categories.updated_at >= since` + `time_entries.updated_at >= since`，转成 `SyncChange[]` 返回（`action` 永远是 `update`，无论实际是新增还是修改）。包含边界是为了重放与 cursor 同时间戳的记录，避免同毫秒/同时间窗口记录被 `> since` 跳过。
- timestamp cursor 路径也会拉取 `sync_tombstones.deleted_at >= since`，转成 `time_entries/delete` 或 `categories/delete` 变更返回。
- 客户端应用 `categories/delete` 时会在单个 Dexie 事务中删除本地目标分类、后代分类和这些分类下的 entries；远端拉取应用删除不写本地 `syncLog`。如果删除 entries 后删除 categories 失败，事务会回滚，避免留下半删除状态。

**tombstone 保留约束**：`sync_tombstones` 不能按固定 90 天 TTL 直接删除。长期离线客户端可能仍持有旧 `sinceSeq` 或旧本地记录；如果服务端提前删除 tombstone，客户端上线后会把已删除记录当作本地独有数据重新 push，造成数据回滚。安全清理必须同时满足：服务端知道所有活跃客户端的同步水位、存在全量修复兜底（force-pull/force-push），并且清理任务有人工确认或可审计日志。

## 3.5 全量同步兜底

全量同步只允许用户手动触发，不自动执行。

服务端新增三个接口：

| 接口 | 作用 |
|---|---|
| `GET /api/sync/status` | 返回服务端分类数、记录数、最新更新时间、稳定内容哈希、最新 `sync_seq` 和服务器时间 |
| `POST /api/sync/force-push/prepare` | 生成短时确认 token，返回当前服务端摘要 |
| `POST /api/sync/force-push` | 在确认 token + 短语正确时，用客户端提交的完整 categories/timeEntries 覆盖服务器 |

`force-push` 是破坏性操作：服务端必须先用 shared runtime schema 校验 `/force-push/prepare` 与 `/force-push` 请求。`prepare` 要求 `categoryCount` / `entryCount` 是有限非负整数，`lastUpdatedAt` 是 UTC ISO 或 `null`；最终 `force-push` 要求非空 `confirmToken`、确认短语字面量 `OVERWRITE_SERVER`，以及符合 `CategorySchema` / `TimeEntrySchema` 的完整数据。畸形 JSON、负数、小数、Infinity 或字段类型错误返回 400 `invalid_request`，不会进入确认 token 消费或 `validateForcePushPayload()`。形状校验通过后，服务端还会做跨记录业务关系校验：分类 ID 和记录 ID 不能重复，分类不能自引用或形成第三级，父分类和记录分类必须存在，提交的记录时间段不能互相重叠；父分类关系用按 ID 建好的映射表判断，避免全量 force-push 数据量变大时退化成重复线性查找。校验通过后，服务端必须先调用 `createServerBackup('sync_force_push')`，再在单个 SQLite 事务中清空 `sync_tombstones`、`time_entries`、`categories` 并导入请求数据。成功后写 `sync_logs.action = 'force_push_applied'`，并刷新 `sync_state` 中的 commit hash。

`force-push/prepare` 生成的确认 token 当前存放在 `packages/server/src/routes/sync.ts` 的进程内 `Map`，TTL 为 5 分钟。token 只能消费一次：成功执行 `/api/sync/force-push` 后立即从内存中删除；过期、缺失或复用都会返回 403，并写入 `sync_logs`（例如 `force_push_expired` 或 `force_push_rejected`）。`prepare` 和最终成功覆盖也分别写入 `force_push_prepare`、`force_push_applied`，用于审计高风险覆盖操作。它只适合单实例部署：进程重启会清空 token，横向扩容时不同实例之间不会共享 token。启动时如果设置了 `SERVER_REPLICAS>1`，服务端会打印告警；真正多实例部署前应改成 SQLite 或 Redis 存储。

`DataResetPrepareResponse` 虽然也定义在 `packages/shared/src/types.ts`，但它属于 `/api/data/reset/prepare` 的人工维护确认契约，不是同步接口；普通同步、force-push 和客户端同步诊断都不会调用 `/api/data/reset`。

客户端设置页会先展示本地/云端摘要，再要求输入确认短语 `OVERWRITE_SERVER` 并勾选最终确认。连续非网络同步失败达到 3 次时，只提示进入诊断流程，不自动全量拉取或推送。

验收和排障路径：

1. 服务器先更新到包含本节接口的版本；旧服务器会让新 APK 在 `/api/sync/status` 或 `/api/sync/force-push/*` 上遇到 404。
2. 用同一 API 地址和 Token 访问 `GET /api/health`，确认基础连接、反向代理和鉴权配置没有问题。
3. 用带鉴权请求访问 `GET /api/sync/status`，应返回 `categoryCount`、`entryCount`、`lastUpdatedAt`、`contentHash`、`latestSeq`、`serverTime`。
4. 客户端进入 `设置 → 数据设置 → 同步健康诊断`，点击"检查本地与云端状态"，应显示本地/云端摘要和建议原因。
5. 非生产环境可继续点"准备覆盖云端"，确认后应返回短时 token 并展示 `OVERWRITE_SERVER` 输入框；生产数据不要为了验收执行最后的"确认用本地覆盖云端"。
6. 只在测试库或已确认要恢复的真实事故中执行最终覆盖；成功后服务端 `data/backups/` 必须有 `sync_force_push` 备份，响应里也会返回 `backupId`。

如果 APK 显示服务器连接失败，先区分三类问题：`/api/health` 失败通常是地址、HTTPS、反代或网络问题；`/api/health` 成功但 `/api/sync/status` 404 通常是服务器版本旧；`/api/sync/status` 返回 401/403 通常是 Token 不匹配或请求没带 `Authorization`。

客户端 `syncPullRecent(days)` 拉最近 `days` 天的服务器变更；普通 `regularSync()` 的 meta 主路径当前传 `7`，`legacy_snapshot_sync` 本地快照修复路径当前传 `2`：

- 对每条 change：
  - 本地不存在 → 直接写入；delete tombstone 对本地不存在的记录是 no-op。
  - 本地存在 + `updatedAt` 相同 → 跳过。
  - 本地存在 + `updatedAt` 不同 + 有未同步的本地修改 → **冲突**，加进 `conflicts`。
  - 本地存在 + `updatedAt` 不同 + 没有本地修改 → 直接覆盖。
  - 远端 `time_entries/delete` + 本地同 record 存在未同步 `syncLog` → 挂起为 `SyncConflict { remote: null, remoteAction: 'delete' }`，不删除本地记录。
  - 远端 `categories/delete` 会先计算目标分类、后代分类和关联 entries；如果影响范围内任一 record 有未同步 `syncLog`，同样挂起为 `remoteAction: 'delete'` 冲突，不执行级联删除。
  - 远端 delete + 本地无 pending change → 保持原行为，直接删除本地记录；分类删除仍级联删除后代分类和关联 entries。
- 写完后，客户端只在本次 pull 返回了变更时更新 `localStorage.timedata_last_synced`，值取返回 `changes` 里的最大 `timestamp`；不再直接用 `response.serverTime` 推进游标，避免查询完成到响应返回之间的新变更被跳过。
- 因为服务端会 `>= since` 重放边界记录，客户端必须把本地已有且 `updatedAt` 相同的 category / entry 当作幂等重复跳过；重复 tombstone 删除本地已不存在的 entry 时也不计入 applied。当前仍是兼容性的 timestamp cursor 修补，不是最终的 `(updated_at, id)` 复合 cursor 或服务端单调版本号方案。

`syncPull({mode:'repair'})` 是修复模式：从头拉一遍，但**已完整且本地更新的 entry 不覆盖**（防止把好数据替换为残缺数据）。这条手动修复/全量拉取路径返回的是 applied 数量，不返回 `SyncConflict[]`；它按服务器状态直接应用 delete，用于用户明确选择“从云端修复/替换”的场景。A4 的“远端 delete vs 本地 pending”挂起保护只在普通同步使用的 `syncPullRecent()` 路径生效。

## 4. 冲突解决

UI 拿到 `SyncConflict[]` 后调 `resolveConflicts(conflicts, resolution)`：

- `keep_local`：什么都不做，本地保留，下次 push 自然把本地版本送上去。对 `remoteAction: 'delete'` 冲突来说，这等价于保留本地 pending log，下次 push 会把本地记录重新创建/更新到服务器。
- `use_remote` + `remoteAction: 'update'`：在一个 Dexie 事务中用服务器版本覆盖本地，并把同一 `tableName + recordId` 的未同步本地 `syncLog` 标为 `synced=1`，避免下次 push 再把已放弃的本地版本推回服务器。
- `use_remote` + `remoteAction: 'delete'`：接受服务器删除。本地删除对应 record，并删除受影响 record 的 pending `syncLog`；分类删除会级联删除目标分类、后代分类、关联 entries，并清除这些受影响记录的 pending log。

### 远端删除 vs 本地未同步修改

- 触发条件：pull 收到一条 `action: "delete"`，且本地同 record 或分类级联影响范围内存在 `synced=0` 的 `syncLog`。
- 冲突形状：`SyncConflict { remote: null, remoteAction: "delete" }`，其中 `remote: null` 表示服务器上这条记录已经不存在。
- 用户选项：
  - 保留本地：pending log 不变，下次 push 会重新 create/update 到服务器。
  - 接受删除：删除本地记录并清除 pending syncLog；分类删除按同一套级联范围处理。
- 设计来源：审批意见 A4，“本地 commit 标志 + 远端 commit 标志，不一致则不同步”。

> 同步整体设计正在评估优化方案。改这块前先看当前代码、本文长期文档，以及本地-only 的 `docs_local/plans/` 中是否有最新过程计划。

## 5. 不变量与约束

写新逻辑前确认这些不变量：

1. **客户端写业务表必须同时写 `syncLog`**（否则数据丢同步）。
2. **服务端 `sync_push` 是原子事务**：要么整批写入 + 备份，要么完全不动。
3. **同步变更有依赖顺序**：`orderPushChanges` 必须保持 category create/update → time_entries → category delete，避免 entry 引用缺失分类或 category delete 早于 entry delete 触发外键失败。
4. **`updatedAt` 字典序比较**：所有时间字段必须前缀格式一致（`YYYY-MM-DDTHH:mm:ss...`）。
5. **服务端 commit hash 必须随写路径失效或刷新**：`recordSeq`、CLI 创建记录会把 `sync_state` 标记为 dirty，由下一次 `/api/sync/status` 惰性重算；force-push 与 reset 类全量替换会立即刷新 `sync_state`。新增服务端写路径时必须同步处理 commit hash，否则 `/api/sync/status` 会返回旧摘要。
6. **server 是冲突仲裁者**：普通 push 不再因为服务器时间较新直接拒绝本地写入；服务端用 `baseSeq` 判断是否 fast-forward、非重叠合并或本地覆盖，并用受保护备份记录本地覆盖场景。

## 6. 错误码处理（客户端侧）

`SyncPushOutcome.reasonCode` 各值客户端的处理由 `packages/client/src/sync/reason.ts` 的 `classifyReasonCode()` 统一分类，分类类型为 `SyncReasonCategory`：

| reasonCode | 分类 | 客户端处理 |
|---|---|---|
| `applied` | `applied` | 标记对应 Dexie `syncLog` 为 `synced=1`。 |
| `missing_payload` / `invalid_shape` / `id_mismatch` | `client_bug` | 标记对应 `syncLog` 为 `synced=1`，停止反复推送；同时放入 `clientBugIssues`，用于诊断/开发者可见错误。 |
| `archived_category` / `missing_category` / `overlap` / `invalid_time_range` / `foreign_key_failed` | `user_actionable` | 不标记已同步，保留在 `syncLog`；放入 `pushIssues` 与 `userActionableIssues`，设置页同步摘要提示用户处理。对 `invalid_time_range` 且 message 指向未来结束时间的本地记录，用户可进入 `设置 → 数据设置 → 本地未来记录修复`，检查并删除当前设备本地的未来结束记录；该入口只改本地 IndexedDB 和 `syncLog`，不直接修改服务器数据库。若异常记录在本地创建后从未成功同步，修复会把对应未同步 create 轨迹标为已处理，不再追加 delete 意图，避免下次同步继续推送同一条未来记录。 |
| `server_version_newer_or_same` | `conflict` | 不标记已同步，保留在 `pushIssues`，进入现有冲突/同步问题处理路径。 |
| 未识别值 | `unknown` | 不标记已同步，保留在 `pushIssues`，避免静默丢弃未来新增原因码。 |

`SyncPushReasonCode` 是封闭枚举；新增值必须同步更新 shared schema、server validation / resolver 映射、`classifyReasonCode()`、客户端测试和本文档表。

## 7. 同步日志

两套独立的"同步日志"，名字像但作用不同：

| 表 | 在哪 | 作用 |
|---|---|---|
| Dexie `syncLog` | 客户端 IndexedDB | 待同步队列；新数据用 `synced=0/1`；未同步项才会被 push |
| SQLite `sync_logs` | 服务端 | 运维审计；记录每次 push/pull 的摘要、谁同步的、有没有冲突 |

客户端每次 `regularSync` 完成会调 `reportToServer`，把 push/pull/conflict 的摘要写到服务端 `sync_logs`。这是**纯日志，best-effort**——失败不影响同步，只影响运维可观测性。

`/api/admin/sync` 读取最近 50 条服务端 `sync_logs`，会优先把 JSON detail 解析为结构化对象；如果 `rejected` / `conflicts` 数字段大于 0，该日志分别计为 1 条近期拒绝/冲突日志。`row.action` 里的 `rejected` / `conflict` 仍作为兼容兜底。旧式 `accepted=1 rejected=1 conflict=1` 文本不再作为主要计数来源。

服务端有 `/api/admin/sync-logs` 路由可读/清/插（CLI 暂未使用），清空日志必须发送 `X-Confirm: true`。客户端本地 timestamp 与 seq cursor 的 key 集中在 `packages/client/src/db/index.ts`（`LAST_SYNCED_KEY`、`LAST_SYNCED_SEQ_KEY`），恢复备份或重置本地数据时通过 `resetSyncCursors()` 一起清理。

## 8. 改这块代码前的清单

> 2026-05-19 复核：Plan 09 收尾仅做 lint 形式修复（移除未用类型 import、字符串拼接改模板字面量、测试 SQL 字符串格式化），同步语义不变。

- [ ] 看 `packages/server/src/sync/validation.test.ts`、`resolver.test.ts`、`order.test.ts`、`backup.test.ts`：覆盖很全，**先跑测试**。
- [ ] 看 `packages/client/src/sync/engine.test.ts`：客户端压缩、冲突收集都有测。
- [ ] 跨 client/server 同步链路改动后，跑 `pnpm --filter @timedata/client test:e2e`；测试入口是 `packages/client/src/__tests__/e2e/sync-roundtrip.e2e.test.ts`，server 内存实例 helper 在 `packages/server/src/__tests__/e2e/helpers.ts`。
- [ ] 改 `SyncPushReasonCode` 枚举：在 `shared/src/types.ts` 加值后，server 验证、client 处理、本文档第 6 节、`data-model.md` 的表都要更新。
- [ ] 改 `regularSync` 主路径：先测 meta no-op、pull-only repair、push + pull_recent_7d，以及 `legacy_snapshot_sync` 本地快照修复路径。
- [ ] 验 full sync fallback：先测 `/api/health`，再测带鉴权的 `/api/sync/status`，最后在测试库走 `设置 → 数据设置 → 同步健康诊断` 和 force-push prepare；不要在生产库为验收执行最终覆盖。
