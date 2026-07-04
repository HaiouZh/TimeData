---
type: evergreen
title: 备份与恢复
covers:
  - packages/client/src/backup/**
  - packages/client/src/quick-notes/**
  - packages/client/src/lib/adminApi.ts
  - packages/client/src/lib/serverBackup.ts
  - packages/client/src/pages/settings/SettingsDataPage.tsx
  - packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx
  - packages/server/src/sync/backup.ts
  - packages/server/src/sync/domains.ts
  - packages/server/src/sync/dailyBackup.ts
  - packages/server/src/routes/admin/backups.ts
  - packages/server/src/routes/admin/_helpers.ts
  - packages/server/src/routes/admin/backupConfig.ts
  - packages/server/src/routes/sync.ts
  - packages/shared/src/admin-schemas.ts
  - packages/shared/src/types.ts
last-reviewed: 2026-07-04
---

<!-- 复核 2026-06-25（设置页信息架构）：SettingsDataPage 只收束到 design token 视觉壳，备份导出、恢复、自动备份和强制覆盖语义均不变。 -->
<!-- 复核 2026-06-27（设计语言 P1）：quick-notes 展示组件只迁移 token / typography / Phosphor 图标，Quick Notes 独立备份 JSON、Markdown 导出、导入合并和 syncLog 语义均不变。 -->
<!-- 复核 2026-07-04（同步 staleGuard）：sync push 的 unknown_base / non-fast-forward 仍会先创建受保护服务端备份；新增 stale_change_rejected 只影响是否应用变更，不改变备份格式或恢复流程。 -->

# 备份与恢复

> **Sync ≠ Backup**。同步是多设备同步当前数据；备份是防误删/防迁移失败/防服务器丢数据。
> 详细背景见 [`adr/0002-sync-not-equal-backup.md`](../adr/0002-sync-not-equal-backup.md)。

TimeData 现有三种备份/可恢复文件：

| 备份类型 | 谁产生 | 触发时机 | 存在哪 |
|---|---|---|---|
| Backup JSON 手动导出 | 客户端 | 用户在设置页主动点 | 用户下载到本机 |
| Quick Notes 独立备份 JSON | 客户端 | 用户在速记页或设置页主动点 | 用户下载到本机 |
| Server backup `.db` | 服务端 | seq 冲突、重叠删除、force-push、手动按钮、每日定时 | `data/backups/<id>.db` |

设备端第四层"自动滚动备份"（Dexie `autoBackups` 表）已于 2026-07-02 整层退役，见 §5 与 [ADR 0015](../adr/0015-remove-client-auto-snapshots.md)。

## 1. Backup JSON 格式

当前唯一格式：`"format": "timedata.backup"`（常量在 `packages/client/src/backup/schema.ts`）。Backup 只接受 UTC 时间：`timeFormat` 必须是 `"utc"`，`timeEntries` 中的 `startTime` / `endTime` 也必须是带 `Z` 的 UTC ISO 字符串。

```json
{
  "format": "timedata.backup",
  "timeFormat": "utc",
  "exportedAt": "2026-05-07T21:30:00.000Z",
  "appVersion": "0.1.0",
  "device": {
    "deviceId": null,
    "deviceName": "Web"
  },
  "categories": [/* Category[] */],
  "timeEntries": [/* TimeEntry[] */],
  "domains": {
    "tasks": [/* Task[] */],
    "quick_notes": [/* QuickNote[] */],
    "tracks": [/* Track[] */],
    "track_steps": [/* TrackStep[] */],
    "goals": [/* Goal[] */],
    "goal_layout_pins": [/* GoalLayoutPin[] */],
    "health_heart_rate": [/* ... */],
    "health_hrv": [], "health_sleep": [], "health_stress": [], "runs": []
  }
}
```

**备份骑客户端域登记簿（关键设计）**：导出/校验/恢复都从 `packages/client/src/sync/clientDomains.ts` 的 `CLIENT_SYNC_DOMAINS` 派生，不再手写表名。每个域声明 `backup` 角色：

- `"core"`：`categories` / `time_entries`，命名顶层字段，带专属完整性校验（两级分类树、记录外键）。
- `"bundled"`：普通状态域（`tasks`、`quick_notes`、`tracks`、`track_steps`、`goals`、`goal_layout_pins`、5 个健康域），进通用 `domains` map，按 **table 名（snake_case）** 键入，逐条用各自 schema 校验、按登记簿 `keyOf` 或默认 `id` 去重。Goal 的 `members` 与 typed `prerequisites` 是核心字段，随 `domains.goals` 完整导出/校验/恢复；Goal 图用户钉点随 `domains.goal_layout_pins` 完整保存，复合键由 `(goalId,nodeKind,nodeId)` 计算。**新增普通域只要在登记簿标 `backup:"bundled"` 并在复合键域提供 `keyOf`，导出/校验/恢复全部白捡**（派生列表见 `BACKUP_BUNDLED_DOMAINS`）。
- `"excluded"`：`settings` 等不进备份。

`timeFormat` 恢复前必须存在且值只能是 `"utc"`。`timeEntries` 的 `startTime` / `endTime` 必须是带毫秒和 `Z` 的 UTC ISO 字符串且 `endTime > startTime`。任务时间字段同样 UTC `.sssZ` 或 `null`，重复规则满足 shared `RecurrenceSchema`；终止式重复的 `count` / `until` 随 `recurrence` JSON 保存，`completedCount` 记录已完成次数，`weight` 记录想法重力权重，`completedAt` 记录普通任务完成时间，`tags` 保存自由标签数组，`ruleId` / `skipped` 是 occurrence 实体化地基字段。缺省会归一为 `completedCount=0`、`weight=0`、`completedAt=null`、`tags=[]`、`ruleId=null`、`skipped=false`。分类树只支持两级结构。

**域的"缺省 vs 存在"语义（恢复安全关键）**：`domains` 里**缺省**的域恢复时**原样保留本地数据**，不清空；只有**存在**（哪怕是 `[]`）的域才会被清空+覆盖。完整导出始终写齐全部 bundled 域（空的也写 `[]`），所以完整恢复语义不变。

**包含**：`categories`、`timeEntries`，以及 `domains` 下的 `tasks`、`quick_notes`、`tracks`、`track_steps`、`goals`、`goal_layout_pins` 和 5 个健康域。

**不包含**（明确不导出）：

- `syncLog`（待同步队列，跨设备无意义）
- API URL、Token（**安全考虑，不可暴露**）
- UI 设置 / 同步 settings（例如睡眠分类）/ 临时计时器状态（`backup:"excluded"`）
- 机密域（未来的密码本）：在加密备份落地前**绝不进明文备份**；相关设计成熟后再沉淀到 evergreen 或 ADR。

> 注：速记除了进完整备份，仍保留独立的 `timedata.quick-notes.backup` 格式（按日期/范围导出，见 §1.5），作为"只导速记"的便捷通道；完整备份是它的超集，不是替代。

外部 Backup JSON 不保留旧格式兼容路径：当前格式用 `domains` map 承载普通域，旧的顶层 `tasks` 字段不再读取。

## 1.5 Quick Notes 独立备份格式

速记备份是独立格式，不等于完整 `timedata.backup`：

```json
{
  "format": "timedata.quick-notes.backup",
  "timeFormat": "utc",
  "exportedAt": "2026-06-01T12:00:00.000Z",
  "notes": [/* QuickNote[] */]
}
```

实现入口：

- `packages/client/src/quick-notes/schema.ts`：格式常量与运行时校验，复用 shared 的 `QuickNoteSchema`。
- `packages/client/src/quick-notes/exportQuickNotes.ts`：按 `occurredAt` 日期、范围或当前多选集合导出 JSON / Markdown。
- `packages/client/src/quick-notes/importQuickNotes.ts`：只导入速记，merge 模式。
- `packages/client/src/quick-notes/deleteQuickNotesRange.ts`：按本地日期闭区间删除速记。
- `packages/client/src/quick-notes/deleteQuickNotesByIds.ts`：按多选 ID 批量删除速记。
- `packages/client/src/quick-notes/fileDownload.ts`：Web 下载和 Capacitor Documents + Share 落盘。

`packages/client/src/quick-notes/` 还包含速记页交互与展示组件（如菜单、剪贴板、时间线窗口 Hook、搜索/高亮、上传状态、长文本折叠和 Markdown 安全渲染）；这些不是备份格式入口，不改变本节 JSON / Markdown 契约。展示组件可以随 [design-language](design-language.md) 迁移 token / typography / Phosphor 图标，但不得改变导出字段、导入合并或删除写 `syncLog` 的语义。

语义：

- `format` 必须是 `timedata.quick-notes.backup`，`timeFormat` 必须是 `"utc"`。
- `notes` 每条必须满足 `QuickNoteSchema`：`text` 非空，`occurredAt` / `createdAt` / `updatedAt` 都是 UTC `.sssZ`；可带 `pinned?: boolean`。
- `notes` 可带 `source?: "user" | "agent"`、`sourceLabel?: string` 与 `pinned?: boolean`；JSON 导出/导入会保留这些展示元数据和置顶状态，Markdown 导出仍只输出时间和正文。agent 速记的深蓝弱边框样式、置顶区和多选态都是客户端展示逻辑，不额外进入备份格式。
- 导入只合并 `quickNotes`，不修改 categories、timeEntries、settings、syncLog 以外的业务表，也不要求分类存在。
- 同 ID 不存在则插入；同 ID 存在且导入记录 `updatedAt` 更新则覆盖；`updatedAt` 相同或本地更新则保留本地。
- 导入插入会写 `syncLog("quick_notes", id, "create")`，导入覆盖会写 `syncLog("quick_notes", id, "update")`；范围删除和按 ID 批量删除都会逐条写 `syncLog("quick_notes", id, "delete")`。
- 第一版不提供“仅速记破坏性全量覆盖恢复”。如果以后需要，必须新增显式确认短语和单独设计。

## 2. 导出（`exportBackup`）

`packages/client/src/backup/exportBackup.ts`：

1. 同时读 Dexie `categories`、`timeEntries`，并通过 `BACKUP_BUNDLED_DOMAINS` 读取 `tasks`、`quick_notes`、`tracks`、`track_steps`、`goals`、`goal_layout_pins` 和健康 bundled 域。
2. 构造 `BackupDocument`（含 `timeFormat: "utc"`），`exportedAt` 用当前时间，`appVersion` 从 `import.meta.env.VITE_APP_VERSION` 读，缺省 `0.1.0`。
3. `device.deviceName` 默认 `"Web"`，可被参数覆盖（mobile 端会传 `"Android"` 等）。
4. **只构造 JS 对象**，不直接下载——下载是 UI 层用 `fileDownload.ts` 做的。

无副作用，可以反复调。

## 3. 校验（`validateBackup`）

恢复前必跑。`validateBackup` 用 shared 包的 `CategorySchema`、`TimeEntrySchema`、各 bundled 域 schema 与 `UtcIsoStringSchema` 严格校验分类、记录、任务、轨道、目标、目标布局钉点和时间字段。正常通过 TimeData 客户端导出的备份文件不会受影响；手工编辑过的备份如果时间字段不带毫秒、不带 `Z` 或带时区偏移，会被拒绝，建议改成 `2026-05-19T03:00:00.000Z` 这种 `.sssZ` 格式后重试。任务记录经 `TaskSchema` 归一化，旧记录缺少 `completedCount`、`weight`、`completedAt`、`tags`、`ruleId` 或 `skipped` 时分别按 0、0、`null`、`[]`、`null`、`false` 恢复；`recurrence.count` 与 `recurrence.until` 同时存在会被拒绝。轨道记录经 `TrackSchema` / `TrackStepSchema` 归一化，`refs` / `tags` 缺省为空数组；目标记录经 `GoalSchema` 归一化，`members` / `prerequisites` 缺省为空数组，并拒绝重复成员、前置边引用非成员、自环、重复边和环；目标布局钉点经 `GoalLayoutPinSchema` 校验，并按 `(goalId,nodeKind,nodeId)` 检查重复。

`packages/client/src/backup/validateBackup.ts` 检查：

| 错误码 | 检查内容 |
|---|---|
| `NOT_OBJECT` | 根不是 object |
| `INVALID_FORMAT` | `format` 不是 `timedata.backup` |
| `INVALID_EXPORTED_AT` | `exportedAt` 不是 UTC `.sssZ` 字符串 |
| `INVALID_APP_VERSION` | `appVersion` 不是字符串 |
| `INVALID_DEVICE` | `device` 字段不规范 |
| `INVALID_CATEGORIES` | `categories` 不是数组，或单条未通过 `CategorySchema` |
| `INVALID_TIME_ENTRIES` | `timeEntries` 不是数组，或单条未通过 `TimeEntrySchema` |
| `INVALID_DOMAINS` | `domains` 字段存在但不是对象 |
| `INVALID_DOMAIN_RECORDS` | 某个 bundled 域不是数组，或单条未通过对应 shared schema |
| `INVALID_TIME_FORMAT` | 备份缺少 `timeFormat: "utc"` |
| `INVALID_TIME_ENTRY_TIME` | 记录时间不是 UTC ISO，或 `endTime <= startTime` |
| `INVALID_CATEGORY_TREE` | 分类自引用、形成环，或超过两级分类树 |
| `DUPLICATE_CATEGORY_ID` | 分类 ID 重复 |
| `DUPLICATE_ENTRY_ID` | 记录 ID 重复 |
| `DUPLICATE_DOMAIN_ID` | 某个 bundled 域内 ID / `keyOf` 重复 |
| `ORPHAN_CATEGORY_PARENT` | 子分类的 `parentId` 在备份里找不到 |
| `ORPHAN_ENTRY_CATEGORY` | 记录的 `categoryId` 在备份里找不到 |

**仍未检查**（已知缺口）：

- 字段类型严格性之外的业务格式（如 `color` 是否合法 CSS 颜色）

这些缺失是**有意的轻量化**：恢复后用户同步时 server 会再校验一次，校验失败的记录会被拒绝并冒泡给用户。如果未来出现“恢复看似成功但同步全被拒”的常见反馈，可以把更严的校验前置到客户端；但 `endTime > startTime`、UTC 格式和分类树循环等会导致同步大面积失败的问题，恢复入口已经前置拦截。

## 4. 恢复（`importBackup`）

`packages/client/src/backup/importBackup.ts` 行为：

```
1. validate(backup)        失败直接 throw
2. db.transaction("rw"):
     timeEntries.clear()
     bundled domains present in backup.domains clear()
     syncLog.clear()
     categories.clear()
     categories.bulkAdd(backup.categories)
     timeEntries.bulkAdd(backup.timeEntries)
     bundled domains present in backup.domains bulkAdd()
3. resetSyncCursors()       清掉 timestamp 与 seq 两个同步 cursor
```

**关键语义**：

1. **替换式恢复**：先清空再写入，不是合并。这是用户预期的行为（"用这个备份覆盖一切"）。
2. **同 ID 分类保留当前名称**：导入外部备份时，如果当前库里已有同 ID 分类，导入流程保留当前分类名称，避免备份把分类名改回去；记录仍通过 `categoryId` 正常关联。任务不引用分类，不参与这层名称保护。
3. **同时清空 `syncLog`**：恢复后没有任何"待推送"日志。这意味着恢复完成后，**服务器上仍然是恢复前的数据**——客户端不会自动 push 把服务器覆盖。
4. **清掉本地同步 cursor**：`resetSyncCursors()` 同时清理 `LAST_SYNCED_KEY`（`timedata_last_synced`）和 `LAST_SYNCED_SEQ_KEY`（`timedata_last_synced_seq`），下次 pull 会从头来一遍，让用户能看到服务器的现状。

**用户侧应该做的事**（UI 应提示）：

- 恢复完成后看一眼：客户端是备份的状态，服务器是它原本的状态。
- 如果想"用本地覆盖服务器"——手动同步，本地 syncLog 是空的，所以同步只会把服务器拉下来覆盖本地……这一步 UI 必须明确警告。
- 如果想"先拿服务器现状再决定"——直接同步即可。

UI 提示文案在 `SettingsDataPage.tsx`，每次改恢复流程时都要顺便审一下文案。

### 4.1 恢复前应该做的事（"before-restore" 安全备份）

代码里 `importBackup` 本身没有内建“恢复前自动下载一份”，这个流程是 UI 层做的：先调 `exportBackup` 触发下载，再调 `importBackup`。

- 手动 Backup JSON 恢复入口使用 `TimeData-before-restore` 文件名前缀。

### 4.2 下载实现（`fileDownload.ts`）

`downloadBackupFile()` 会根据运行环境选择落盘方式，所有调用方必须 `await`：

- **浏览器/PWA**：构造 Blob、创建 `<a download>` 并触发点击，1 秒后再 `URL.revokeObjectURL()`。锚点临时挂到 `document.body` 上以兼容 Firefox。
- **Capacitor Android**：用 `@capacitor/filesystem` 把 JSON 写入 `Directory.Documents`，再调用 `@capacitor/share` 让用户选择保存或分享目标（系统 Files、邮件、即时通讯等）。文件名前缀与浏览器侧一致。若用户取消分享会被静默吞掉，已经写盘的文件仍保留。

Phase 5.3 的人工验收清单里有“导出 + 恢复 Backup JSON”一步（见 `packages/mobile/README.md`）。修改这块代码后必须：

- 在 Web 端验收浏览器下载文件；
- 在 Android APK 上验收 `Filesystem.writeFile` + Share 流程；
- 执行 `pnpm --filter @timedata/mobile android:sync` 让新增的 Capacitor 插件落到 Android 工程。

## 5. 自动滚动备份（已退役）

设备端自动滚动备份（`autoBackup.ts` 模块、Dexie `autoBackups` 表、`/settings/data/backup-history` 展示页、分类 mutation 的级联 patch）已于 2026-07-02 整层退役并物理删表（Dexie v15 `autoBackups: null`）：它全量序列化三张表且串行阻塞在同步主链上，而恢复价值已被服务端 `auto_daily` 定时备份 + 危险路径受保护备份覆盖。决策与后果见 [ADR 0015](../adr/0015-remove-client-auto-snapshots.md)。强制替换/强制推送前不再创建本地快照，确认弹窗改为如实警示"本地未同步的改动将丢失"。

## 6. Server backup（服务端快照）

`packages/server/src/sync/backup.ts` 的 `createServerBackup(operation)`：

- 在 `<DB_PATH>/../backups/` 下生成 `<operation>-<ISO 时间>.db` 文件。
- 用 `better-sqlite3` 的 `db.backup()` API（在线热备份，不阻塞写）。
- 普通快进 push 且不会删除重叠时间记录时不创建服务端备份，`SyncPushResponse.backupId` 为 `null`。
- `local_wins_non_fast_forward` 创建 `sync_local_wins`，`unknown_base` 创建 `sync_unknown_base`，都在 apply 前标成受保护备份。
- 时间记录 push 若会删除服务器上重叠记录，先用 `findOverlappingEntryIds()` 同源探测，再创建 `sync_overlap_delete` 受保护备份；真实删除仍由 `deleteOverlappingEntries()` 写 tombstone 与 seq。
- force-push 覆盖核心同步表前创建 `sync_force_push` 并标 protected，`reason = "force_push_overwrite"`。
- `POST /api/sync/backup` 创建 `manual` protected 备份，设置页“立即在服务器备份”按钮调用它。
- `runDailyBackupIfDue()` 创建 `auto_daily`，不 protected；服务启动补判一次，进程内 timer 每 5 分钟挂钟判断一次，admin `POST /api/admin/backups/run-daily` 可手动触发。
- 创建完成后会调用 `cleanupServerBackups()`；服务启动时也会跑一次 cleanup。清理成功删除旧备份时输出 `[backup] cleanup removed old backups` 或 `[backup] startup cleanup removed N old backups`，清理失败输出 `[backup] cleanup failed` / `[backup] startup cleanup failed`。

**保留策略**：

- protected 永久保留；admin `DELETE /api/admin/backups/:id` 可以显式删除 protected 备份。
- 非 protected 只保留扁平 N 天窗口，默认 7 天，由 admin `GET/PUT /api/admin/backup-config` 配置。
- cleanup 同时对账磁盘孤儿：manifest 有条目但文件丢失时移除条目；manifest 没登记但磁盘有 `.db` 时按文件名解析 operation 与时间。
- 已知 protected 类前缀孤儿（`sync_force_push`、`sync_local_wins`、`sync_unknown_base`、`sync_overlap_delete`、`manual*`）不自动删除，只记录日志；无法解析时间的孤儿也保守保留。
- 非保护类孤儿（如旧 `sync_push`、`auto_daily`）按 N 天窗口删除。

**配置与状态**：

- `manifest.json` 形状为 `{ backups, meta }`；`meta.dailyBackup`、`meta.retentionDays`、`meta.lastDailySeq` 是服务端自有状态。
- `meta` 不进入同步 `settings` 域、不进入 Backup JSON、不被普通设备同步修改。
- `lastDailySeq` 记录上次 `auto_daily` 时的 latestSeq；若 latestSeq 没变化，日备返回 `reason = "no_change"`，不空拍。
- 每日备份的时点判断使用 `packages/server/src/lib/timezone.ts` 的 app-local 时间，配置格式为 `HH:MM`。

可用端点：

- `POST /api/sync/backup`：同步 token 下创建 `manual` protected 备份。
- `GET /api/admin/backups`：列出服务端备份，retention 用 `classifyBackupRetention()` 统一计算。
- `DELETE /api/admin/backups/:id`：删除备份文件和 manifest 条目。
- `GET/PUT /api/admin/backup-config`：读取/更新 `dailyBackup` 与 `retentionDays`。
- `POST /api/admin/backups/run-daily`：手动调用 `runDailyBackupIfDue()`。

实现位置：`packages/server/src/sync/backup.ts` 的 `cleanupServerBackups()` 与 manifest 管理。`readBackupManifest()` 只把 manifest 不存在视为静默空状态；JSON 损坏、权限错误等其他读取失败会输出 `[backup] failed to read manifest`，但仍返回空 manifest，避免写入路径因观测元数据损坏而中断。

## 7. 改这块代码前的清单

- [ ] 跑 `packages/client/src/backup/*.test.ts`：导出、校验、恢复都有测试。
- [ ] 改 Backup JSON 字段：同步更新 `BackupDocument`、`exportBackup`、`validateBackup`、恢复入口和本文档。
- [ ] 改恢复语义（如改成"合并"或"自动 push 覆盖服务器"）：先看 ADR 0002，理解为什么恢复**不**自动覆盖服务器，再决定。
- [ ] 改 `validateBackup` 错误码：在 `BackupValidationErrorCode` 加新值，UI 提示文案要同步加。
- [ ] 改服务端备份保留窗口 / 定时配置 / manifest `meta`：同步更新 `backup.ts`、`dailyBackup.ts`、admin 配置端点、本文档，并跑 server 全量测试与 `pnpm check:docs:strict`。
