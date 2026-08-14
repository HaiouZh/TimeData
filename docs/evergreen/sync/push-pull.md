---
type: evergreen
title: 同步 · 推拉协议详解
covers:
contracts:
  - packages/shared/src/schemas.ts
  - packages/shared/src/taskCompletion.ts
  - packages/shared/src/trackStatusOp.ts
  - packages/client/src/sync/reason.ts
  - packages/server/src/sync/domains.ts
  - packages/server/src/db/reset.ts
  - packages/server/src/routes/data.ts
last-reviewed: 2026-08-10
---

# 同步 · 推拉协议详解

> [sync](../sync.md) 的**协议子文档**：push 与 pull 一趟具体怎么跑，以及全量同步兜底。
> 讲什么：客户端 push 的压缩与分类处理、服务端 push 的排序 / 校验 / 记账、tasks 与 tracks 的语义 `op` 与守卫列、pull 的分页与应用规则、force-push 与 reset 的账本保全。
> 不讲什么：账本模型与域登记簿、整体流程、冲突解决 UI 规则、不变量与约束、错误码含义（都在 [母文档](../sync.md)）；登记簿的校验与 LWW 细节见 [sync/domain-registry](domain-registry.md)。

## 承上启下

- **上游**：[母文档](../sync.md) §0 的账本模型与 `SYNC_DOMAINS` 登记簿；本文是它的流程展开。
- **下游**：客户端 `sync/engine.ts` 的一轮同步、服务端 `/api/sync/push` 与 `/api/sync/pull` 路由。
- **契约**：记账边界（只有 `applied` 占 seq）、`serverNow` 分配时间戳、守卫列只在带 `op` 时可写、pull 游标只认 `sinceSeq` 且逐批前进。
- **邻居**：[母文档](../sync.md)、[sync/domain-registry](domain-registry.md)（登记簿驱动的校验与 apply 规则）、[sync/realtime-and-scheduler](realtime-and-scheduler.md)（bump 与调度）、[sync/troubleshooting](troubleshooting.md)（观测与排障）。

<a id="sync-push-flow"></a>

## 1. Push 流程详解

<a id="sync-client-push"></a>

### 1.1 客户端做了什么（`syncPush`）

1. 从 Dexie `syncLog` 取所有未同步日志（`synced=0`）。
2. **按 `tableName:recordId` 分组压缩**（`compactSyncLogs`）：同一记录多次改只保留最后一条；`create+...+delete` 整组省略不发送但本地标已同步；`create+update` 合并为 `create`。
3. 从业务表读最新数据填进 `change.data`（delete 除外）。`tasks` 域的完成语义还会把压缩组里时间序最后一条 `op` 带进 change：完成后又改标题时，最后一条日志本身无 `op`，压缩结果仍保留前一条完成 `op`，避免 push 快照失去“有意修改完成字段”的授权。
4. **附带分类依赖**（`categoryDependencyChangesForEntry`）：push 的 entry 引用的分类还没在服务器上时，把分类（和它的父分类）一起塞进 changes，避免"先 push entry 因分类不存在被拒"的死锁。
5. POST `/api/sync/push`，请求体 `{ changes, baseSeq, requestId? }`。`baseSeq` 来自本地读数，服务端用它判断快进、非重叠合并、重叠冲突还是 unknown-base 保守路径。`requestId` 是对冲/重试幂等键（每批 `crypto.randomUUID()`，409 拆出的子批换新 id）：命中服务端 `sync_push_requests` 回放表时直接原样返回首发的状态码与响应体，不重复 apply、不占新 seq；备份竞态 409 与内部 500 不进回放表，详见 [ADR 0020](../../adr/0020-sync-push-request-idempotency.md)。入口先过 `SyncPushRequestSchema`，不合法返回 400 `invalid_request`。
6. 服务器 200 返回后按 `SyncPushOutcome.reasonCode` 分类处理本地 syncLog：`applied`、`client_bug` 和 `stale_rejected` 类标已同步；`user_actionable` / `conflict` / `unknown` 保留。HTTP 409 有**两种形状，别混**：校验失败的 409 返回完整 `SyncPushResponse`（带 accepted/rejected outcomes、`latestSeq`、`appliedCount`），表示整批原子拒绝，accepted outcome 的 reasonCode 为 `validated`、只代表"通过校验"、不能确认日志；客户端把被拒项按类归置（client_bug/stale 标 synced=1，其余隔离为 `synced=2` 死信）后立即重试合法子批，只有重试 200 后才确认。**备份竞态的 409（`push_retry_after_backup_race`）走的是通用 error 形状**，只带错误与 `backupId`，没有 outcomes / `latestSeq` / `appliedCount`；客户端靠 `isSyncPushResponse()` 判形状，不满足就不进拆批分支、直接抛错走整轮重试。`stale_change_rejected` 会进入 `pushIssues`，但客户端放弃本地主张，随后回声 pull 落地服务器权威版本。
7. `pushIssues` / `clientBugIssues` / `userActionableIssues` 暴露给 UI / 诊断。

<a id="sync-server-push"></a>

### 1.2 服务端做了什么（`/api/sync/push`）

1. `orderPushChanges`（登记簿优先级驱动）：upsert 按 `SYNC_DOMAINS.upsertPriority`，delete 按 `deletePriority`；categories upsert 组内再做父子拓扑排序。关键依赖是不对称的：entry 引用分类，所以分类 upsert 先于 entry；轨道步骤依赖轨道，所以 track upsert 先于 step、step delete 先于 track；目标钉点依赖目标，所以 pin 晚于目标。完整顺序以 [sync/domain-registry](domain-registry.md) 的登记簿为准，不在主流程手抄。
2. `validateSyncChanges`（登记簿驱动，规则见 [sync/domain-registry](domain-registry.md)）。
3. **任意一条 invalid 就整体拒绝**：返回 409 + 全部 outcomes，不写业务表、`sync_seq`、tombstone 或 SSE；accepted outcome 的 reasonCode 为 `validated`（不是 `applied`），表述 passed validation。
4. 根据 `baseSeq` 与 change 的**完整影响集合**分析：分类删除展开后代分类/关联 entries，时间记录 upsert 展开预计被覆盖的 overlap IDs。普通快进 / 非重叠合并不创建服务端备份；`unknown_base` / `local_wins_non_fast_forward` / 隐式删除会在 apply 前创建受保护备份。备份完成后再次比对 `latestSeq`；期间账本前进则 409 让客户端重试，不用过时分析继续 apply。
5. 在一个 SQLite 事务里逐条 `applyChange`（登记簿驱动，规则见 [sync/domain-registry](domain-registry.md)）。冲突记录按时间戳线性化：`analyzePushBaseSeq` 命中的 `overlappingRecords` 启用 staleGuard，`unknown_base` 全量保守启用；比较基线冻结在本批 apply 开始前，来包 `change.timestamp <=` 当时的服务器现存行 `updated_at` 或 tombstone `deleted_at` 时返回 `stale_change_rejected`，不写库、不占 seq。同批前序变更新产生的 tombstone 不得误伤后序 change。快进和非重叠记录不比时间戳，避免同设备快速连续编辑被服务器分配的 `updated_at` 误拒。每条成功写入都追加 `sync_seq` 并把 commit hash 标 dirty。
6. 写一条 server-side `sync_logs` 摘要，事务后 `notifySyncChange(getLatestSeq(), buildBumpPayload(...))`——bump 在条数与字节上限内直接带上本批增量 changes，超限则只推游标。
7. 响应带 `latestSeq`（apply 后账本最新号）与 `appliedCount`（本批记账数 = apply 事务前后 `getLatestSeq()` 之差）；客户端据 `latestSeq − baseSeq === appliedCount` 判定无插队、跳过回声 pull（见 [ADR 0016](../../adr/0016-push-latestseq-and-pull-pagination.md)）。rejected 的 409 响应同样带这两字段（`appliedCount: 0`）。

登记簿的校验、通用 LWW、复合键 LWW 和 manual 域钩子细节统一维护在 [sync/domain-registry](domain-registry.md)，避免新增域时主流程文档和登记簿文档分叉。

<a id="sync-tasks-tracks-op"></a>

### 1.2.1 tasks / tracks 语义 op

`tasks` 域的 `done` / `completedAt` / `skipped` / `lastDoneAt` / `completedCount` 是完成语义字段，不再允许普通整行快照无条件覆盖。写入方用守卫字段 diff 推导可选 `op`——客户端本地写入时推，服务端 `routes/agent.ts` 代写任务时同样调 `completionOp` 推：

- `complete`：`done` 从 false 变 true，或 create 出已完成任务。
- `reopen`：`done` 从 true 变 false。
- `skip`：`skipped` 从 false 变 true，或 create 出 skipped occurrence。
- `amend`：其他完成语义字段有意变化，例如重复规则重锚时重置 `lastDoneAt` / `completedCount`。

`op` 是授权标志，不是服务端重算指令；服务端不会理解 occurrence 业务，只把带 `op` 的 tasks upsert 视为“允许这次快照写完成字段”。`SERVER_SYNC_DOMAINS.tasks.lww.guardedColumns` 将 SQLite 列 `done`、`completed_at`、`skipped`、`last_done_at`、`completed_count` 标为守卫列：无 `op` 的 upsert 在 `ON CONFLICT DO UPDATE SET` 里排除这些列，保留服务器现值；INSERT 分支仍全列写入，因为行不存在时没有现值可保护。

这解决 R2 场景：设备 A 勾选任务并带 `op: complete` 上行后，设备 B 基于旧快照只改标题或排序，即使整行 payload 里仍是 `done=false`，无 `op` 的 update 也只能更新标题/排序，不能把服务器上的完成态翻回。部署顺序为客户端先行、服务端后行：旧客户端遇到新服务端时无 `op` 的勾选无法写入完成字段，但旧客户端的拖拽/改标题也无法误翻完成态；新客户端遇到旧服务端时 `op` 会被旧契约剥离，行为退回旧整行覆盖，不比现状更差。完整决策见 [ADR 0018](../../adr/0018-tasks-completion-op.md)。

`tracks.status` 同样是守卫列。`updateTrack` / `setTrackStatus` / agent `PATCH /api/agent/tracks/:id` 只有在状态实际变化时附 `op:{type:"status",at}`；无 op 的 tracks upsert 仍可更新标题、摘要、refs，但不能覆盖服务器上的 `status`。`track_steps` 另有宿主轨道闸：create/update 找不到宿主 track 时返回 `orphan_step_rejected` 并跳过落库；客户端把它归类为 `stale_rejected`，标记本地日志已处理并通过回声 pull 接受服务器权威状态，避免孤儿步骤重复推送。

### 1.2.2 tasks 删除死因归档

`tasks` 的 delete 生效前，`resolver.ts` 在 `DELETE FROM tasks` 之前调 `SERVER_SYNC_DOMAINS.tasks.lww.archiveDelete` 钩子，把即将删除的整行快照 `INSERT` 进 `deleted_tasks_archive`（`task_id` / `payload` JSON / `delete_reason` / `deleted_at`）。行不存在（回声删除、重复 delete）时钩子 no-op，不写归档；staleGuard 拒收的 delete 同样不落库不归档。归档不参与同步域、不出现在 pull/push 协议里，纯服务端审计侧写；`GET /api/tasks/deleted-archive` 提供只读查询供统计页消费。

`deleteReason` 是可选字段，只有 `tasks` 域的 delete change 承载（`shared/src/schemas.ts` `TASK_DELETE_REASONS`：`user` / `cascade` / `occurrence` / `mirror`，缺省 `unknown`），client `lib/tasks.ts` 各删除调用点在生成 delete 变更时打标，账本与上行组包原样透传到服务端。

### 1.3 记账边界

只有 `status === "applied"` 的变更才追加 `sync_seq`；skipped 不占 seq。所有写入路径的 `updated_at` / `deleted_at` 都由服务端当前时间 `serverNow` 分配，不取 `change.timestamp`。

<a id="sync-pull-flow"></a>

## 2. Pull 流程详解（严格 seq 补差）

`/api/sync/pull` 行为：

- 入参 `{ sinceSeq: number | null, limit?: number }`，`SyncPullRequestSchema` 校验：`sinceSeq` 必须是有限非负整数或 `null`，`limit`（可选）为正整数；缺 `sinceSeq`、负数、小数、Infinity、类型错都返回 400 `invalid_request`。**游标只认 `sinceSeq`**：`since` / `lastSyncedAt` 等时间戳游标字段不被接受，缺 `sinceSeq` 一律 400。
- `sinceSeq: 0` 与 `null` 等价 = 全量。
- 服务端按 `sync_seq` 找出 cursor 后每个 `table_name + record_id` 的**最新**变更（同一记录改 5 次只回最后状态）：delete → 读 tombstone 组成 delete change；其他 → 调域 `readRecord` 读当前行。响应带 `latestSeq`；带 `limit` 时按去重后 `sync_seq.id` 升序取前 `limit` 条，并返回 `nextSinceSeq`（本批最后一个 seq id，按 seq 前进、不管某条 change 是否被过滤成 null）与 `hasMore`（取到行数 === limit）。不带 `limit` 时全量、`hasMore=false`、`nextSinceSeq` 收敛到 `latestSeq`（见 [ADR 0016](../../adr/0016-push-latestseq-and-pull-pagination.md)）。
- 客户端用 `SyncPullResponseSchema` 校验响应；不合法抛错不写本地。
- 客户端 `fetchPullBatches` 带 `limit: PULL_PAGE_LIMIT`（500）循环拉批：每批 apply 后**逐批**把游标推进到 `nextSinceSeq`（**绝不**中途跳 `latestSeq`——中途失败可断点续传、不漏批），`hasMore` 则 `yieldToMainThread()` 让出主线程后继续；全部拉完 `advanceSeqCursor(response)` 收尾到 `latestSeq`（幂等）。日常量小单批等价现状。

客户端每个 pull page 都在一个覆盖 `syncLog` 与本页实际业务 stores 的 Dexie transaction 内重新读取 pending 后 apply；本地写入只能完整发生在事务前或事务后，不会插入 pending 快照与远端覆盖之间。畸形分页（`hasMore=true` 但 `nextSinceSeq` 缺失、不前进或越过 `latestSeq`）直接抛协议错误，保留上一批游标，不允许跳到末尾。

客户端应用规则（`syncPullSinceSeq()`，普通同步路径）：

- 本地不存在 → 直接写入；delete tombstone 对本地不存在的记录是 no-op。
- 本地存在 + `updatedAt` 相同 → 幂等跳过。
- 本地存在 + `updatedAt` 不同 + 有未同步本地修改 → **manual 域**（categories / time_entries）挂起为 `SyncConflict`；**lww 域**（完整清单见 [sync/domain-registry](domain-registry.md)）跳过远端，本地待推送版本获胜，不进冲突 UI。
- 本地存在 + `updatedAt` 不同 + 无本地修改 → 直接覆盖（自己 push 后回拉的服务器分配时间戳也走这条，幂等无害）。
- 远端 delete + 本地同 record（或分类级联影响范围内）有未同步 `syncLog` → 挂起为 `SyncConflict { remote: null, remoteAction: 'delete', sourceLogIds }`，不删本地；分类整树作为一个冲突单元，保护集合跨 pull 分页保持，后代墓碑不能先删一半。
- 远端 delete + 本地无 pending → 直接删除；分类删除级联后代分类和关联 entries。

**被跳过的远端 change 不会有第二次机会**：上面第 3 条的「lww 域跳过远端」是**静默丢弃**——游标照常推进到 `nextSinceSeq`，该条 change 不会重发，只有等这条记录下次在服务端再被改动才会重新下行。且这条跳过不产生 `SyncConflict`、不进 `pushIssues`、不写任何日志，线上完全不可观测。它与 [整行粒度](../sync.md#sync-row-granularity) 的 push 合起来构成双向丢失窗口。

`syncPull({mode:'repair'})` 是修复模式：`sinceSeq: 0` 全量；仍有 pending 的同记录或分类级联整组不覆盖/不删除，已完整且本地更新的 entry 继续保留。repair 不生成冲突 UI，但不能吞掉尚未同步的本地主张。

**tombstone 保留约束**（沿用 [ADR 0006](../../adr/0006-sync-tombstone-retention.md)）：`sync_tombstones` 与 `sync_seq` 都不按 TTL 自动清理。长期离线客户端持有旧读数，提前清账会导致已删除记录被当作本地独有数据重新 push。安全清理必须同时满足：知道所有活跃客户端水位、有全量修复兜底、有人工确认。

<a id="sync-full-fallback"></a>

## 3. 全量同步兜底

全量同步只允许用户手动触发，不自动执行。

| 接口 | 作用 |
|---|---|
| `GET /api/sync/status` | 返回公开业务计数（分类、时间记录、速记）、最新更新时间、`contentHash`、`latestSeq`、服务器时间；`contentHash` / `latestSeq` 仍受 tasks 等所有同步域影响 |
| `POST /api/sync/force-push/prepare` | 生成短时确认 token，返回当前服务端摘要 |
| `POST /api/sync/force-push` | token + 短语 `OVERWRITE_SERVER` 正确时，用客户端核心同步表覆盖服务器 |

force-push 是**五个覆盖域的差异替换**：shared schema/跨记录业务校验 → 受保护 server backup → 备份后 `latestSeq` 乐观校验 → 在单事务内把 `categories`、`time_entries`、可选 `settings`、`quick_notes`、`tasks` 的快照转成 create/update/delete changes，经正常 resolver 写业务表、tombstone 与只增 `sync_seq` → 审计 → SSE。父分类删除复用一次服务端级联，不重复生成子分类/entry delete change。全局账本和全域 tombstone 不清空，轨道、目标、目标钉点等非覆盖域数据/历史删除保持原样，旧游标设备可增量收到覆盖域删除。

客户端 force-push 在同一只读 Dexie transaction 内捕获五域快照和当时的 pending 日志 ID；成功后只确认这组 ID。请求期间新增日志和非覆盖域日志必须保留。该路径是用户确认的低频冷路径，允许为差异计算扫描五个覆盖表；普通增量热路径不增加扫描或网络往返。完整决策见 [ADR 0019](../../adr/0019-destructive-sync-operations-preserve-ledger.md)。

`POST /api/data/reset` 与一次性 UTC reset 同样不再清空账本：单事务删除登记簿覆盖的全部同步域，为旧记录写 tombstone + delete seq，再重建默认分类并写 create/update seq；`reset.ts` 启动时断言 reset 域集合与 `SYNC_DOMAINS` 对齐。手动 reset 备份期间若账本前进则 409，成功后发 SSE。根分类 delete seq 先于其级联后代，便于分页客户端从第一页建立整树保护。

五重保护（诊断、短时 token、确认短语、最终确认、服务端备份）与设置页流程不变。客户端连续非网络同步失败达 3 次只提示进入诊断，不自动全量。

排障路径：`/api/health` 失败查地址/HTTPS/反代；`/api/sync/status` 404 查服务器版本；401/403 查 token。**注意：旧版客户端在新服务器上 `/api/sync/pull` 会 400**——server / Web / APK 必须同版本发布（见 ADR 0012 部署注意）。
