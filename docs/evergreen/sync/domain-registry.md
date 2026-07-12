---
type: evergreen
title: 同步 · 域登记簿
covers:
  - packages/shared/src/syncDomains.ts
  - packages/shared/src/syncDomains.test.ts
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/schemas.ts:SyncChangeSchema
  - packages/shared/src/types.ts:SyncChange
  - packages/server/src/sync/domains.ts
  - packages/server/src/sync/domains.test.ts
  - packages/server/src/sync/fake-domain.e2e.test.ts
  - packages/server/src/sync/health-charts.e2e.test.ts
  - packages/server/src/sync/tracks-domain.e2e.test.ts
  - packages/server/src/sync/goals-domain.e2e.test.ts
  - packages/server/src/sync/goal-layout-pins-domain.e2e.test.ts
  - packages/client/src/sync/clientDomains.ts
  - packages/client/src/sync/clientDomains.test.ts
contracts:
  - packages/shared/src/syncDomains.ts
  - packages/shared/src/schemas.ts:SyncChangeSchema
  - packages/shared/src/types.ts:SyncChange
  - packages/server/src/sync/domains.ts
  - packages/client/src/sync/clientDomains.ts
last-reviewed: 2026-07-12
---
<!-- 复核 2026-07-12（tasks 删除死因归档）：shared/src/schemas.ts/syncDomains.ts、server/src/sync/domains.ts、shared/src/types.ts 为 tasks 域新增可选 deleteReason 字段与服务端 archiveDelete 钩子，不新增/改变运行时同步域数量或登记簿结构。 -->

# 同步 · 域登记簿

> [sync](../sync.md) 的域登记簿子文档：系统认识哪些同步域、shared/server/client 三端登记簿如何保持一致、新增普通 LWW 域和复合键域要改什么。
> 不讲 push/pull 主流程、冲突 UI、SSE 和 force-push 细节；这些仍在 [sync](../sync.md)。

<!-- 复核 2026-07-10（validated reasonCode + syncLog 死信位）：新增 reasonCode "validated" 与 syncLog.synced=2 属于 push 回执/客户端 outbox 语义（见 sync.md 与 data-model.md），不新增同步域，也不改变各域登记簿条目。 -->
<!-- 复核 2026-07-04（同步 staleGuard）：新增 reasonCode stale_change_rejected 与 applyChange staleGuard 属于 push 冲突仲裁语义，不新增同步域，也不改变各域登记簿条目。 -->
<!-- 复核 2026-07-04（tasks 完成语义 op）：tasks 仍是既有 LWW 域，未新增同步域；server LWW 映射仅增加 guardedColumns，用于无 op 的 upsert 撞行时保留完成语义列。 -->
<!-- 复核 2026-07-04（tracks 并发时间语义）：tracks / track_steps 仍是既有 LWW 域，未新增同步域；tracks 增加 status guardedColumns，track_steps 增加宿主轨道闸。 -->

## 承上启下

- **上游**：各业务域 schema、SQLite / Dexie 表、shared 静态类型与 zod schema。
- **下游**：[sync](../sync.md) 的 `orderPushChanges`、`validateSyncChanges`、`applyChange`、`syncPullSinceSeq()`，以及 [backup](../backup.md) 的完整备份角色。
- **契约**：运行时 `SyncChangeSchema` 由 shared 登记簿生成；静态 `SyncChange` 判别联合在 `types.ts` 手工维护，必须与运行时 schema 对齐。
- **邻居**：[data-model](../data-model.md)（跨域数据契约）、[backup](../backup.md)（backup 角色与 force-push 范围）、各业务域文档（字段语义与页面行为）。

## 1. 三端登记簿

| 层 | 文件 | 内容 |
|---|---|---|
| shared | `packages/shared/src/syncDomains.ts` | `SYNC_DOMAINS`：每域的 `table`、`dataSchema`（zod）、`upsertPriority` / `deletePriority`、`conflictPolicy`（`lww` / `manual`）、`countsInStatus`。`SyncChangeSchema` 运行时校验由它生成；`tasks` upsert 特判允许可选完成语义 `op`，非 tasks 域仍剥离 `op`。 |
| server | `packages/server/src/sync/domains.ts` | `SERVER_SYNC_DOMAINS`：每域可选钩子 `validate` / `crossValidate` / `apply` + 必选 `readRecord`；无 `apply` 钩子的域走通用 LWW 路径（`lww: { idColumn, toRow, guardedColumns? }`）。 |
| client | `packages/client/src/sync/clientDomains.ts` | `CLIENT_SYNC_DOMAINS`：每域的 server table、Dexie store、schema、pull 应用分支、`backup` 角色（`core` / `bundled` / `excluded`）。 |

客户端登记簿的 `backup` 角色驱动完整备份的导出 / 校验 / 恢复，那是 Backup 的关注点，详见 [backup](../backup.md)，不改变同步语义。同一份 `storeName + schema` 还驱动客户端本地 schema 归一 pass：启动时清理 IndexedDB 中不符合当前 shared schema 的本地形状，归一保留 `updatedAt`、不写 `syncLog`、不改同步语义。`taskNeedsApply` 用 `TaskSchema` 投影后深比较，本地孤儿字段不再触发多余 apply。

## 2. 当前运行时域

当前十五个运行时域：

| 域 | 策略 | 备注 |
|---|---|---|
| `categories` | manual | 钩子承载层级校验与级联删除 |
| `time_entries` | manual | 钩子承载未来时间拒绝、重叠覆盖 |
| `settings` | lww | 零钩子，`countsInStatus=false`，承载睡眠分类、打点分类、导航可见入口等 UI 偏好 |
| `quick_notes` | lww | 零钩子 |
| `tasks` | lww | 零钩子，`countsInStatus=false`；服务端配置完成语义 `guardedColumns`，无 `op` 的 upsert 撞现存行时不覆盖 `done` / `completed_at` / `skipped` / `last_done_at` / `completed_count` |
| `tracks` | lww | `countsInStatus=false`；服务端配置状态语义 `guardedColumns`，无 `op` 的 upsert 撞现存行时不覆盖 `status` |
| `track_steps` | lww | `countsInStatus=false` |
| `goals` | lww | `countsInStatus=false`，目标层 |
| `goal_layout_pins` | lww | `countsInStatus=false`，目标图用户钉点，复合键域 |
| `health_charts` | lww | 健康统计页视图块配置 |
| `health_heart_rate` / `health_hrv` / `health_sleep` / `health_stress` / `runs` | lww | 5 个健康数据域，零钩子，`countsInStatus=false`，走通用 LWW 路径 |

登记簿是封闭的：加域必须改代码、过测试。静态类型 `SyncChange`（`types.ts` 手工判别联合）与运行时 schema（登记簿生成）必须同步修改；`health_charts`、`tracks`、`track_steps`、`goals`、`goal_layout_pins` 都已有静态分支。

## 3. 新增域成本

### 3.1 校验与写入分发

`validateSyncChanges` 对每条 change 依次过三层：

1. **基础形状**：`recordId` / `timestamp` / `action` 缺失 → `invalid_shape`；表名不在登记簿 → `invalid_shape`。
2. **通用校验**（`validateGenericChange`，全域一致）：delete 直接接受；upsert 要求有 payload（`missing_payload`）、payload 过域 `dataSchema`（`invalid_shape`，entry 的 `endTime <= startTime` 映射为 `invalid_time_range`）、payload identity === recordId（`id_mismatch`）。普通域的 identity 是 `payload[idColumn]`；复合键域可由 server `identity` hook 计算。时间字段由 schema 收紧为严格 `YYYY-MM-DDTHH:mm:ss.sssZ`。
3. **域钩子**：
   - `time_entries.crossValidate`：同批 entries 互相重叠 → `conflict / overlap`。
   - `time_entries.validate`：`endTime` 不能晚于当前 UTC（`invalid_time_range`）；分类必须存在（`missing_category`）且未归档（`archived_category`）。
   - `categories.validate`：不能自引用、只支持两级（`invalid_shape`）；父分类必须存在（`missing_category`，同批 push 的算存在）。
   - `goal_layout_pins.validate`：delete 时也必须能 decode 复合 `recordId`。
   - `settings` / `quick_notes` / `tasks` / `tracks` / `track_steps` / `goals`：无钩子，通用校验即全部。

`applyChange` 按登记簿分发：有 `apply` 钩子走钩子，否则走通用 LWW 路径。**所有路径的 `updated_at` / `deleted_at` 都取服务器当前时间 `serverNow`，不取 `change.timestamp`**。push 路由对 `baseSeq` 重叠或 unknown-base 记录启用的 staleGuard 是登记簿分发前的通用守卫，不改变任何域的 `validate` / `apply` 钩子归属。

- **通用 LWW**（settings、quick_notes、tasks、tracks、track_steps、goals、health_charts、健康数据域及未来的零钩子域）：delete = 真删除 + tombstone upsert；upsert = 删 tombstone + `INSERT ... ON CONFLICT DO UPDATE`（列来自域的 `toRow()`，主键与 `created_at` 只在插入时写）。域可以声明 `guardedColumns`：来包无 `op` 时这些列不进 `DO UPDATE SET`，目前 tasks 用于保护完成语义字段，tracks 用于保护 `status`。`track_steps.track_id` 不建 SQL 外键，轨道删除必须由客户端或未来服务端受控入口显式发每条步骤删除。
- **复合键 LWW**（`goal_layout_pins`）：语义仍是 LWW，但不能走单列主键通用 SQL。server 用 `identity` 从 payload 算 `recordId`，custom apply/read 按 `(goal_id,node_kind,node_id)` 读写，delete 仍真删除 + tombstone。
- **categories 钩子**：delete = 级联删除目标分类、后代分类与关联 entries，每条都写 tombstone + delete seq；根分类先记账，再记关联 entries/后代分类，分页客户端可先建立整树冲突保护；upsert 清旧 tombstone 后正常写入。
- **time_entries 钩子**：upsert 先清该 record 的旧 tombstone，再删除与该记录时间段重叠的旧远端记录（写 tombstone + delete seq，outcome 带 `overriddenRecordIds` 和 `backupId`）；分类不存在时 skip 并带结构化 `skipReason`。分类级联与 overlap 的隐式影响集合同时进入 baseSeq 冲突分析和 staleGuard。
- 只有 `status === "applied"` 的变更才记账（skipped 不占 seq）。

待办域的重复规则、tags、排序、完成状态、想法重力 `weight`，以及子任务（独立 `Task` 行，靠 `parentId` 指向 root）的 create/update/delete、重复完成代理写入的 occurrence（确定性 id）及其 children，都仍是既有 `tasks/create`/`tasks/update`/`tasks/delete` change：客户端 helper 通过 Dexie transaction 写 `tasks` + 本地 `syncLog`，授权 agent 回写（含 `note` 建 child）构造 change 后走 `applyChange()` + `sync_seq` + SSE 通知。完成语义字段额外通过 `op` 授权写入：无 `op` 的 tasks upsert 仍可更新标题、排序、tags、weight 等非守卫列，但不能在撞现存行时覆盖 `done` / `completedAt` / `skipped` / `lastDoneAt` / `completedCount`。这**不新增同步域、不动 `SyncPushReasonCode` 与登记簿条目数**；静态 `SyncChange` 的 tasks upsert 成员允许可选 `op`。`parentId` 的一层结构约束**只在 force-push 全量快照兜底校验**（`forcePushValidation`：自引用 / 缺失父 / 二层嵌套三种负样本），普通增量 push 故意不挡（依赖客户端 helper，单用户威胁模型取舍）；字段语义与展示桶见 [todo](../todo.md)。

### 3.2 字段演进卫生

LWW 只定义“同一记录发生并发修改时如何自动收敛”，字段退役和自动补齐靠 schema 演进卫生层配合：

- **客户端自动补齐 / 剥离**：`runSchemaNormalizationIfNeeded()` 启动时遍历 `CLIENT_SYNC_DOMAINS` 的 `storeName + schema`，用 shared schema 给缺字段补 `.default(...)`、剥掉 retired / orphan 字段。它保留 `updatedAt`、不写 `syncLog`，整轮成功才推进 `SCHEMA_NORMALIZATION_VERSION`。
- **客户端远端应用前 parse**：pull 收到远端数据后先走对应域 schema；无效 payload 丢弃并 warn。`tasks` 额外用 `TaskSchema` 投影后深比较，避免本地孤儿字段让 `taskNeedsApply()` 误以为远端需要重放。
- **服务端列补齐 / 退役**：新增字段先走 `ensure*Columns()` / `ADD COLUMN` 和 `toRow()` / `rowTo*()` 映射；退役字段先从 shared schema 与 row 映射停读写，再用 `dropColumnsIfExist()` 幂等删物理列。`applyLwwChange()` 只写 `toRow(change.data)` 产出的列，因此退役字段不会继续从同步 payload 搬进 SQLite。

这套机制是 LWW 域能低成本演进的前提，但不替代服务端权威校验，也不会自动把本地卫生变化当作用户修改同步出去。

### 3.3 新增域 checklist

新增一个普通纯 LWW 域的全部成本：

1. shared `syncDomains.ts` 登记一行，设置 `table`、schema、优先级、冲突策略和 `countsInStatus`。
2. server `domains.ts` 写 `lww` 映射和 `readRecord`。
3. `types.ts` 扩展静态 `SyncChange` 判别联合，并让 shared schema 测试覆盖运行时 / 静态对齐。
4. 客户端 Dexie 表、`CLIENT_SYNC_DOMAINS`、pull 应用分支和 backup 角色。
5. 参照 `fake-domain.e2e.test.ts` 写一条全链路域测试，并更新对应业务域文档、[data-model](../data-model.md)、[backup](../backup.md) 与 [sync](../sync.md) 摘要。

校验、排序、写入、记账、seq 补差、墓碑、SSE 实时下发全部复用同步内核。任务轨道和目标层都是这个模式：`tracks.upsertPriority=70/deletePriority=71`，`track_steps.upsertPriority=71/deletePriority=70`，`goals.upsertPriority=72/deletePriority=72`。验收证明见 `packages/server/src/sync/fake-domain.e2e.test.ts`、`tracks-domain.e2e.test.ts`、`goals-domain.e2e.test.ts` 与 `health-charts.e2e.test.ts`。

复合键 LWW 域还要补：

- shared recordId helper。
- client `keyOf`。
- server `identity` / custom `apply` / custom `readRecord`。
- `backfillMissingSeq()` 的行级 `recordId` 生成规则，不能靠 payload.id 或单列 pk。

`goal_layout_pins.upsertPriority=73/deletePriority=73` 是第一例，验收证明见 `goal-layout-pins-domain.e2e.test.ts`。

## 4. 操作清单

- [ ] shared `syncDomains.ts` 登记域，并确认 `upsertPriority` / `deletePriority` 不破坏依赖顺序。
- [ ] shared `types.ts` 扩展 `SyncChange` 静态判别联合。
- [ ] shared `schemas.test.ts` / `syncDomains.test.ts` 覆盖运行时 schema 接受新域。
- [ ] server `domains.ts` 写 `lww` 映射 + `readRecord`；复杂域加 `validate` / `crossValidate` / `apply`。
- [ ] client Dexie 表 + `CLIENT_SYNC_DOMAINS` + engine pull 分支。
- [ ] 若实体 schema 新增默认字段或退役字段，升 `SCHEMA_NORMALIZATION_VERSION`，并按 [data-model](../data-model.md) 的时序处理 `ensure*Columns()` / `dropColumnsIfExist()`。
- [ ] 选择 backup 角色（`core` / `bundled` / `excluded`），并明确 force-push 是否纳入当前格式契约。
- [ ] 普通域参照 `fake-domain.e2e.test.ts`；复合键域参照 `goal-layout-pins-domain.e2e.test.ts`。
- [ ] 更新 [sync](../sync.md) 第 0 节摘要、[data-model](../data-model.md)、[backup](../backup.md) 与对应业务域文档。
- [ ] 不让运行时登记簿、静态 `SyncChange` 联合和客户端域登记簿分叉。
