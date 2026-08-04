---
type: evergreen
title: 数据模型与契约
covers:
  - packages/shared/src/types.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/time.ts
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/taskCompletion.ts
  - packages/shared/src/syncDomains.ts
  - packages/shared/src/constants.ts
  - packages/shared/src/healthSchemas.ts
  - packages/shared/src/chartSchemas.ts
  - packages/server/src/db/schema.ts
  - packages/server/src/db/connection.ts
  - packages/server/src/db/reset.ts
  - packages/server/src/lib/db-rows.ts
  - packages/server/src/lib/healthRows.ts
  - packages/server/src/lib/chartRows.ts
  - packages/server/src/lib/serverConfig.ts
  - packages/client/src/db/index.ts
  - packages/client/src/db/schemaNormalization.ts
contracts:
  - packages/shared/src/types.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/time.ts
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/syncDomains.ts
  - packages/shared/src/constants.ts
  - packages/shared/src/healthSchemas.ts
  - packages/shared/src/chartSchemas.ts
  - packages/server/src/db/schema.ts
  - packages/client/src/db/index.ts
last-reviewed: 2026-07-30
---

# 数据模型与契约

> 本文只保留跨域数据契约、全表索引脉、同步信封、时间/ID/字段映射和迁移约定。
> 单个功能域的字段语义与端到端流程下放到对应域文档。

## 1. 数据表索引脉

| 表 / 实体 | SQLite | Dexie | 字段 schema 落点 |
|---|---|---|---|
| 分类 / `Category` | `categories` | `categories` | [categories-settings](categories-settings.md) §Schema |
| 时间记录 / `TimeEntry` | `time_entries` | `timeEntries` | [timeline](timeline.md) §Schema |
| 速记 / `QuickNote` | `quick_notes` | `quickNotes` | [quick-notes](quick-notes.md) §Schema |
| 待办 / `Task`、`Recurrence` | `tasks` | `tasks` | [todo](todo.md) §Schema |
| 任务轨道 / `Track`、`TrackStep` | `tracks` / `track_steps` | `tracks` / `trackSteps` | [tracks](tracks.md) §Schema |
| 目标 / `Goal` | `goals` | `goals` | [goals](goals.md) §Schema |
| 目标布局钉点 / `GoalLayoutPin` | `goal_layout_pins` | `goalLayoutPins` | [goals](goals.md) §存储与同步 |
| 手头软会话 / `Session` | `sessions` | `sessions` | [todo/at-hand](todo/at-hand.md) §Schema |
| 同步设置 / `Setting` | `settings` | `settings` | 本文 §2；具体 key 见对应域 |
| 客户端同步日志 / `SyncLogEntry` | 无 | `syncLog` | 本文 §3 |
| 健康原始数据（数据层，无 UI 消费） | `health_heart_rate` / `health_hrv` / `health_sleep` / `health_stress` / `runs` | `healthHeartRate` / `healthHrv` / `healthSleep` / `healthStress` / `runs` | `shared/src/healthSchemas.ts`；本文 §1.1 |
| 健康图表配置（数据层，无 UI 消费） | `health_charts` | `healthCharts` | `shared/src/chartSchemas.ts`；本文 §1.1 |

### 1.1 健康域：只剩数据层

健康子系统**只有数据层**：没有健康统计页、图表配置面板、佳明设置页、指标/块引擎，也没有服务端抓取管线；体征/跑步数据由独立项目 run-track 采集。这是有意的退役，决策、回溯点与被否决的替代方案见 [ADR 0024](../adr/0024-retire-health-subsystem.md)。

**数据层完整保留**：上述 6 张表（SQLite + Dexie）、`healthSchemas.ts` / `chartSchemas.ts` 字段 schema、`healthRows.ts` / `chartRows.ts` 行映射、6 个同步域（见 [sync/domain-registry](sync/domain-registry.md)）与 backup bundled 域（见 [backup](backup.md)）。历史数据在库里，随同步和备份流转，只是没有 UI 消费。**改这些表/域仍按正常 schema 变更红线走**（见 AGENTS.md「边界 · Schema / 字段变更」）。

服务端辅助表：

| 表 | 作用 |
|---|---|
| `sync_logs` | 记录每次 push/pull 的摘要、状态、备份信息和 `reasonCode` 细节 |
| `sync_tombstones` | 记录删除事件，用于按序拉取删除重放 |
| `sync_seq` | 服务端权威变更序列，`sinceSeq` pull 的唯一 cursor |
| `sync_state` | 服务端状态摘要缓存，避免每次 status 全量扫描业务表 |
| `app_metadata` | 全局一次性迁移/重置标记 |
| `server_config` | 服务端独有配置，例如日记路径模板；不同步客户端。通用 KV 读写：`lib/serverConfig.ts` 的 `getServerConfig`/`setServerConfig` |
| `api_request_logs` | 服务端 `/api/*` 请求审计运维表；不同步客户端，不保存 body、Authorization 或完整 query。`is_new_ip` INTEGER 0/1 列（幂等补列，默认 0）标记该请求的来源范围在其 token tier 下首见 |
| `totp_config` | TOTP 危险操作锁的单行配置表，`id` 恒为 1，`secret` 存 base32 明文；不同步客户端。见 [security](security.md) |
| `totp_recovery_codes` | 恢复码表，主键是 sha256 哈希（不存明文），`used_at` 非空即已消费（一次性） |
| `known_ip_scopes` | 已见来源范围表，复合主键 `(token_tier, scope_key)`，带 `country` / `city` / `asn_org` / `last_ip` / `first_seen` / `last_seen` / `acknowledged`；`acknowledged=0` 即未确认的新来源。`scope_key` 算法与收敛取舍见 [security](security.md#security-new-ip-alert) 与 [ADR 0025](../adr/0025-new-ip-alert-scoped-by-asn-and-city.md)。**`schema.ts` 建表段里有一条常驻的 `DROP TABLE IF EXISTS known_ips`**：它不在一次性迁移脚本里，而是每次进程启动都无条件执行，任何名为 `known_ips` 的表启动即被清空删除。退出条件与「删除前不要新建同名表」的约束记在 ADR 0025 |
| `deleted_tasks_archive` | tasks 域 delete 生效前的整行快照归档，不进同步域，经 `GET /api/tasks/deleted-archive` 只读查询，用于删除死因分析 |
| `sync_push_requests` | push `requestId` 幂等回放表：(requestId → status_code, 原响应 JSON)，TTL 24h 惰性清理；见 [ADR 0020](../adr/0020-sync-push-request-idempotency.md) |

## 2. Settings 键值契约

`settings` 是同步键值表。服务端 `settings.key` 是主键，`value` 是字符串，`updated_at` 参与 `/api/sync/status` 的 commit hash。客户端入口是 `packages/client/src/lib/settings/index.ts`，`setSetting()` 必须在同一个 Dexie transaction 内写 `settings` 与 `syncLog(tableName="settings")`。

常见 key 的所有权：

| key | 所属文档 |
|---|---|
| `sleep.categoryId` | [stats-insights](stats-insights.md)、[categories-settings](categories-settings.md) |
| `punch.categoryId.v1` | [categories-settings](categories-settings.md)、[timeline](timeline.md) |
| `nav.visibleTabs.v1` | [architecture](architecture.md) 启动/导航概览，具体实现看代码 |
| `stats.layout.v1` | [stats-insights](stats-insights.md) |
| `stats.module.trend.v1` | [stats-insights](stats-insights.md) |
| `todo.defaultDestination.v1` | [todo](todo.md) |
| `todo.gravity.v1` | [todo](todo.md) |

## 3. SyncLogEntry

只存在于客户端 Dexie：

```ts
type SyncLogEntry = {
  id: string;
  tableName: SyncTableName;
  recordId: string;
  action: "create" | "update" | "delete";
  timestamp: string;
  synced: 0 | 1 | 2; // 0=待上传 1=已同步/已放弃 2=死信隔离（服务端确定性拒收，不再自动重发）
  op?: TaskCompletionOp | TrackStatusOp; // tasks 完成语义 / tracks.status 写入授权标志
  deleteReason?: TaskDeleteReason; // 只有 tasks delete 承载
};
```

`tableName` 来自 `packages/shared/src/syncDomains.ts` 的封闭登记簿，当前包括 `categories`、`time_entries`、`settings`、`quick_notes`、`tasks`、`tracks`、`track_steps`、`goals`、`goal_layout_pins`、`health_charts`、`sessions` 与健康原始数据域。Dexie 使用 `[tableName+synced]` 复合索引；`op` 与 `deleteReason` 都不是索引字段，加入后无需升 Dexie 版本。同步实体写入与对应 `syncLog` 追写必须在同一个 transaction 内完成；轨道父子删除由客户端数据层显式写每条 `track_steps/delete`，不能依赖数据库级联。`tasks` 完成语义和 `tracks.status` 都用可选 `op` 授权守卫列更新。

## 4. SyncChange / SyncPushOutcome

`SyncChange` 是按 table/action 区分的判别联合；运行时 schema 由 `packages/shared/src/syncDomains.ts` 的登记簿生成，静态类型在 `packages/shared/src/types.ts` 手工维护。新增同步域必须同时改共享登记簿、服务端登记簿、类型、测试和文档。当前静态联合已覆盖 `health_charts`、`tracks`、`track_steps`、`goals`、`goal_layout_pins` 与 `sessions`；运行时登记簿与手工类型必须保持一致，不得分叉。

```ts
type SyncChange =
  | { tableName: T; action: "create" | "update"; recordId: string; data: Entity; timestamp: string }
  | { tableName: T; action: "delete"; recordId: string; data: null; timestamp: string };
```

`tasks` 与 `tracks` 的 upsert 成员各自额外允许可选 `op`（`TaskCompletionOp` / `TrackStatusOp`），其余域的 `op` 由运行时 schema 剥离；`tasks` 的 delete 成员另外允许 `deleteReason?: TaskDeleteReason`，非 tasks 的 delete 同样被剥离。`TaskCompletionOp` 是完成语义授权标志（`complete` / `reopen` / `skip` / `amend`），只控制服务器是否允许这次 tasks 快照覆盖完成字段；不改变 Task 实体 schema 或业务表结构。详见 [sync tasks / tracks op](sync.md#sync-tasks-tracks-op) 与 [ADR 0018](../adr/0018-tasks-completion-op.md)。

服务端对每条 change 输出一个 `SyncPushOutcome`：

```ts
{
  tableName: string;
  recordId: string;
  action: string;
  status: "accepted" | "rejected" | "conflict";
  reasonCode: SyncPushReasonCode;
  message: string;
  incomingTimestamp: string;
  serverUpdatedAt?: string;
  overriddenRecordIds?: string[];
  backupId?: string;
}
```

`SyncPushReasonCode` 是封闭白名单：

| reasonCode | 含义 |
|---|---|
| `applied` | 接受并已写入（仅出现在 200 响应） |
| `validated` | 仅通过校验、未写入（仅出现在 409 原子拒绝批的 accepted outcome，不得据此确认日志） |
| `missing_payload` | create/update 没带 data |
| `invalid_shape` | 字段类型或格式错误 |
| `id_mismatch` | payload identity 与 `recordId` 不一致；普通域是 `data.id !== recordId`，复合键域由 helper 计算 |
| `invalid_time_range` | `endTime <= startTime` |
| `missing_category` | 分类不存在 |
| `archived_category` | 分类已 archived |
| `overlap` | 时间段重叠 |
| `stale_change_rejected` | `baseSeq` 重叠或 unknown-base 路径上，来包时间戳不晚于服务器现存行 / tombstone，服务端拒收过期变更 |
| `orphan_step_rejected` | `track_steps` create/update 找不到宿主 `tracks` 行，服务端拒收孤儿步骤 |
| `server_version_newer_or_same` | 兼容保留码 |
| `foreign_key_failed` | 外键约束失败 |

扩展 reason code 等于改公开契约，必须同步 server validation、client UI/engine、CLI 错误处理和文档。

## 5. 全量同步兜底契约

全量推送兜底当前只覆盖核心同步表：`categories`、`timeEntries`、可选 `settings`、`quickNotes`、`tasks`。服务端在导入前校验分类/记录/速记/任务的 ID 唯一性、父分类存在、记录引用分类存在、时间范围合法、记录之间不重叠等规则；随后把快照转成五域 create/update/delete 差异，经正常 resolver 追加只增账本。健康原始数据、`health_charts`、`tracks`、`track_steps`、`goals`、`goal_layout_pins` 与 `sessions` 不在 force-push 契约内，业务行、tombstone 与 seq 均保持原样。目标成员关系只存在于 `Goal.members`，因此 force-push 的 tasks payload 不携带目标归属。

共享类型：

- `SyncDatasetStatus`：服务端摘要、内容 hash、可选 `latestSeq`。
- `SyncStatusResponse`：状态摘要 + `serverTime`。
- `SyncForcePushPrepareRequest` / `SyncForcePushPrepareResponse`：短时 token、确认短语、过期时间与服务端摘要。
- `SyncForcePushRequest` / `SyncForcePushResponse`：核心同步表数据、服务器备份 ID、导入计数与最新 seq。
- `SyncHealthReport`：诊断结果，不自动触发全量拉取或推送。
- `DataResetPrepareResponse`：数据重置确认 token、固定确认短语 `RESET_DATA` 与过期时间。

全量同步的五重保护和服务器备份见 [sync](sync.md)。

## 6. 增量同步序列契约

服务端 `sync_seq` 是同步 cursor 的权威来源，只增不减。每次 `applyChange()` 成功写入同步实体后追加一行；CLI 受控写入口与业务写入同事务记账；force-push、手动 data reset、一次性 UTC reset 也通过 create/update/delete 差异继续追加账本，不能清空重编号。

- `SyncPushRequest.baseSeq?: number | null`：客户端上次观察到的服务端序列。
- `SyncPullRequest.sinceSeq: number | null`：pull 唯一 cursor；0 或 null 表示全量。
- `SyncPullResponse.latestSeq?: number | null`：服务端当前最新序列。
- `SyncDatasetStatus.latestSeq?: number | null`：状态摘要里的最新序列。

`sync_seq` 不是用户可见历史记录，只表示服务端接收并落库的同步顺序。

## 7. 时间字段约定

所有时间字段一律使用 UTC ISO 字符串（带 `Z`）存储和传输，展示时再转本地时区。共享 `time.ts` 固定应用时区为 `Asia/Shanghai`，并提供本地挂钟时间与 UTC `.sssZ` 字符串之间的转换；服务端、CLI 与客户端表单不得各自发明时区转换。

- **存字符串、比较靠字典序**：固定宽度的 UTC ISO 串其字典序等同时间先后，所以 SQLite/Dexie 直接对字符串字段排序/范围查询即可，无需时间类型。
- Dexie / SQLite 的 `*_at` 字段使用 `new Date().toISOString()`。
- `TimeEntry.startTime` / `endTime` 也是 UTC ISO。
- 客户端表单输入本地时间，保存前转 UTC；加载已有记录再转本地展示。
- 服务端同步校验要求严格 `YYYY-MM-DDTHH:mm:ss.sssZ`。
- CLI 输入本地日期和 `HH:mm`，服务端转换后写 UTC，返回时再转本地展示。
- `updated_at` 由服务端在记账时分配，不使用客户端 `change.timestamp` 或 payload `updatedAt` 作为权威排序。

时间轴与统计窗口如何按本地日期裁剪，见 [timeline](timeline.md) 与 [stats-insights](stats-insights.md)。

## 8. 默认分类预设

`DEFAULT_CATEGORIES` 定义在 `packages/shared/src/constants.ts`，包含五个顶层：睡眠、生存、投资、享乐、运转。`createDefaultCategories(timestamp?)` 同时给客户端和服务端使用，确保两端出厂状态一致。同文件的 `UNCATEGORIZED_COLOR`（冷中性灰，镜像 `--color-ink-3`）是无色分类（未设色或父分类缺失）在统计/图表里的回退色，属用户内容色域；放在 shared 既给统计层（`lib/stats.ts`、`lib/insights/overview.ts`、`TrendSection`）共用，也在设计语言 `check:design` 扫描范围外。

分类管理行为见 [categories-settings](categories-settings.md)。

## 9. SQL 字段映射

SQL 使用 `snake_case`，JS 使用 `camelCase`。没有 ORM，跨边界时手工映射。

| SQL 列 | JS 字段 |
|---|---|
| `parent_id` | `parentId` |
| `category_id` | `categoryId` |
| `start_time` | `startTime` |
| `end_time` | `endTime` |
| `occurred_at` | `occurredAt` |
| `source_label` | `sourceLabel` |
| `track_id` | `trackId` |
| `goal_layout_pins.goal_id` | `goalId` |
| `goal_layout_pins.node_kind` | `nodeKind` |
| `goal_layout_pins.node_id` | `nodeId` |
| `token_tier` | `tokenTier` |
| `client_hint` | `clientHint` |
| `duration_ms` | `durationMs` |
| `device_label` | `deviceLabel` |
| `user_agent` | `userAgent` |
| `started_at` | `startedAt` |
| `ended_at` | `endedAt` |
| `session_id` | `sessionId` |
| `last_done_at` | `lastDoneAt` |
| `start_at` | `startAt` |
| `scheduled_at` | `scheduledAt` |
| `completed_count` | `completedCount` |
| `weight` | `weight` |
| `rule_id` | `ruleId` |
| `skipped` | `skipped` |
| `completed_at` | `completedAt` |
| `sort_order` | `sortOrder` |
| `is_archived` | `isArchived` |
| `created_at` | `createdAt` |
| `updated_at` | `updatedAt` |

JSON 字符串列：`recurrence`、`tasks.tags`、`tracks.refs`、`track_steps.tags`、`track_steps.refs`、`goals.members`、`goals.prerequisites`、`health_charts.config`。布尔列通常以 0/1 存储（`tasks.done`、`tasks.skipped`、`categories.is_archived` 等）。`tasks.parent_id` 和 `track_steps.track_id` 都是普通 TEXT 列；`track_steps.track_id` 不建 SQL 外键，由同步宿主闸拒收孤儿步骤。`track_steps.edited_at` 映射为 `TrackStep.editedAt?`，只表示 user 步正文被编辑过，不参与索引。旧 `tasks.goal_id` / `tracks.goal_id` 目标归属列已退役，启动迁移会幂等删除。

## 10. Dexie schema

当前 Dexie v16：

```ts
db.version(16).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  tasks: "id, parentId, ruleId, sessionId, scheduledAt, sortOrder, updatedAt",
  tracks: "id, status, updatedAt",
  trackSteps: "id, trackId, [trackId+seq], updatedAt",
  goals: "id, kind, status, updatedAt",
  goalLayoutPins: "[goalId+nodeKind+nodeId], goalId, nodeKind, nodeId, updatedAt",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  settings: "key",
  healthHeartRate: "id, date",
  healthHrv: "id, date",
  healthSleep: "id, date",
  healthStress: "id, date",
  runs: "id, date",
  healthCharts: "id, order, updatedAt",
  sessions: "id, startedAt, updatedAt",
});
```

版本历史：v1 初始；v2 `settings`；v3 `quickNotes`；v4 健康表；v5 `tasks`；v6 `tasks.scheduledAt`；v7 `healthCharts`；v8 `tasks.parentId`（子任务=独立 Task，纯 schema 升级无 upgrade 函数）；v9 `tracks` / `trackSteps`（任务轨道数据地基，新表为空，不需要历史归一迁移）；v10 `goals` + 旧 `tasks.goalId` / `tracks.goalId` 索引；v11 移除旧目标归属索引，目标成员关系改由 `Goal.members` JSON 字段承载；v12 `goalLayoutPins`，用 `[goalId+nodeKind+nodeId]` 复合主键保存目标图钉点；v13 `tasks.weight`（想法重力引擎，upgrade hook 给旧 tasks 补 `weight=0`）；v14 `tasks.ruleId` / `tasks.skipped`（occurrence 实体化地基，`ruleId` 建索引，upgrade hook 给旧 tasks 补 `ruleId=null`、`skipped=false`）；v15 物理删除 `autoBackups`（设备端自动快照整层退役，`autoBackups: null`，见 [ADR 0015](../adr/0015-remove-client-auto-snapshots.md)）；v16 `sessions` 表 + `tasks.sessionId` 索引（手头软会话地基，upgrade hook 给旧 tasks 补 `sessionId=null`，见 [todo/at-hand](todo/at-hand.md)）。

## 11. SQLite schema 迁移边界

服务端当前主要依靠 `CREATE TABLE IF NOT EXISTS` 和少量幂等 `ALTER TABLE ... ADD COLUMN` 补列。可以兼容新增表、列、索引；改已有列含义或类型必须写一次性迁移代码，不能只改 schema 字符串并期待已部署实例自动重建。`goal_layout_pins` 是真复合主键表，`PRIMARY KEY (goal_id,node_kind,node_id)`，不加合成 `id` 列；历史 seq 回填必须用 shared helper 生成同一份 encoded `recordId`。

服务端删列走 `dropColumnsIfExist(db, table, columns, indexNames?)`：先按传入索引名 `DROP INDEX IF EXISTS`（SQLite 拒删带索引列），再按 `PRAGMA table_info` 判断列存在才 `ALTER TABLE ... DROP COLUMN`，标识符走白名单校验。删字段分两步：先从 shared schema 与 `rowTo*`/`*ToRow` 映射停读写（物理列变惰性），物理 `DROP COLUMN` 是最后的卫生步骤、可滞后。时序铁律：加字段 server 先行（`ADD COLUMN` + 映射）客户端再写持久值；减字段 shared 先行、两端过 schema 的路径先停搬运、物理删列最后。

## 12. ID 约定

- `Category.id`：默认分类用稳定字符串，用户新建用 UUID。
- `TimeEntry.id`、`QuickNote.id`、`Task.id`：UUID。重复待办物化出的 occurrence 例外——id 是确定性的 `occ:{ruleId}:{dueDate}`，其镜像子任务是 `{occ.id}:child:{模板子任务 id}`；确定性是多设备物化幂等的前提，见 [todo/recurrence](todo/recurrence.md)。
- `Track.id`、`TrackStep.id`、`Goal.id`、`Session.id`：UUID。
- `GoalLayoutPin`：没有 `id` 字段，身份是 `(goalId,nodeKind,nodeId)`；sync `recordId` 由 `encodeGoalLayoutPinKey()` 生成。
- `Setting.key`：稳定字符串 key。
- `health_charts.id`：UUID 或稳定 seed id。
- 客户端、服务端、CLI 都不应分配 ID 后期待另一端“修正”；ID 是不可变身份。

## 13. 服务端后台洞察响应

`Admin*Response` 是 `/api/admin/*` 的只读响应契约，不提供任意 SQL。受控维护端点 `/api/admin/sync-logs` 操作既有 `sync_logs` 表，必须有独立校验和确认保护；`/api/admin/request-logs` 只读查询 `api_request_logs`，用于展示请求审计元数据。`api_request_logs` 是运维表，不是同步域，也不进入 `SyncChange` / `sync_seq` / Backup 格式。

代表类型：

- `AdminSyncResponse`：同步日志、最近 rejected/conflict 数、最近问题列表。
- `AdminBackupRow`：备份文件、大小、保护状态、保留分类、关联 sync log。
- `AdminHealthChecksResponse`：后台健康检查结果；这里的 health 是系统健康检查，不是健康数据域。
- `AdminRequestLogsResponse`：请求审计日志；字段来自 `api_request_logs` 的 snake_case 到 camelCase 映射，包括 `tokenTier`、`clientHint`、`deviceLabel` 和 `durationMs`。

## 14. 客户端 schema 归一

`packages/shared/src/entitySchemas.ts` 的 Zod schema 是跨端实体形状事实源。客户端走首帧优先：React 挂载后才后台启动 IndexedDB 初始化链，在 `seedDefaultCategories()`/`migrateLocalSettingsToDexie()` 之后跑 `runSchemaNormalizationIfNeeded()`（`packages/client/src/db/schemaNormalization.ts`）：以 `STORAGE_KEYS.schemaNormalizationVersion` 做 localStorage 版本闸，遍历 `CLIENT_SYNC_DOMAINS` 的 `storeName + schema`，在一个跨全表 `rw` 事务内把每条记录过 schema：缺字段由 `.default(...)` 补、孤儿字段由 Zod strip、坏行只 `console.warn` 并保留。纯本地卫生：只 `bulkPut` 变化行、保留 `updatedAt`、不写 `syncLog`，整轮成功才推进版本号。改实体 schema 后升 `SCHEMA_NORMALIZATION_VERSION` 即触发老数据对齐；新增索引/表仍走 Dexie 版本链。读取关键路径（如 `listTasks`）用 `TaskSchema.safeParse` parse-on-read 兜底。
