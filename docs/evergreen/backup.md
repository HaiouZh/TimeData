---
type: evergreen
title: 备份与恢复
covers:
  - packages/client/src/backup/**
  - packages/client/src/quick-notes/**
  - packages/client/src/pages/settings/SettingsDataPage.tsx
  - packages/client/src/pages/settings/BackupHistoryPage.tsx
  - packages/server/src/sync/backup.ts
  - packages/client/src/db/index.ts:autoBackups
last-reviewed: 2026-06-19
---

# 备份与恢复

> **Sync ≠ Backup**。同步是多设备同步当前数据；备份是防误删/防迁移失败/防服务器丢数据。
> 详细背景见 [`adr/0002-sync-not-equal-backup.md`](../adr/0002-sync-not-equal-backup.md)。

TimeData 现有四种备份/可恢复文件：

| 备份类型 | 谁产生 | 触发时机 | 存在哪 |
|---|---|---|---|
| Backup JSON 手动导出 | 客户端 | 用户在设置页主动点 | 用户下载到本机 |
| Quick Notes 独立备份 JSON | 客户端 | 用户在速记页或设置页主动点 | 用户下载到本机 |
| 自动滚动备份 | 客户端 | 发生实际同步/恢复/强制替换等可能改写本地数据前 | Dexie `autoBackups` 表，本地，最多 7 份 |
| Server backup `.db` | 服务端 | 每次 push 校验通过、写入前；每次 force-push 覆盖核心同步表前 | `data/backups/<id>.db` |

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
    "health_heart_rate": [/* ... */],
    "health_hrv": [], "health_sleep": [], "health_stress": [], "runs": []
  }
}
```

**备份骑客户端域登记簿（关键设计）**：导出/校验/恢复都从 `packages/client/src/sync/clientDomains.ts` 的 `CLIENT_SYNC_DOMAINS` 派生，不再手写表名。每个域声明 `backup` 角色：

- `"core"`：`categories` / `time_entries`，命名顶层字段，带专属完整性校验（两级分类树、记录外键）。
- `"bundled"`：普通状态域（`tasks`、`quick_notes`、5 个健康域），进通用 `domains` map，按 **table 名（snake_case）** 键入，逐条用各自 schema 校验、按 `id` 去重。**新增普通域只要在登记簿标 `backup:"bundled"`，导出/校验/恢复全部白捡**（派生列表见 `BACKUP_BUNDLED_DOMAINS`）。
- `"excluded"`：`settings` 等不进备份。

`timeFormat` 恢复前必须存在且值只能是 `"utc"`。`timeEntries` 的 `startTime` / `endTime` 必须是带毫秒和 `Z` 的 UTC ISO 字符串且 `endTime > startTime`。任务时间字段同样 UTC `.sssZ` 或 `null`，重复规则满足 shared `RecurrenceSchema`；终止式重复的 `count` / `until` 随 `recurrence` JSON 保存，`completedCount` 记录已完成次数，`turn/turnAt` 记录当前回合状态与进入时间，`completedAt` 记录普通任务完成时间，`tags` 保存自由标签数组。缺省会归一为 `completedCount=0`、`turn=null`、`turnAt=null`、`completedAt=null`、`tags=[]`。分类树只支持两级结构。

**域的"缺省 vs 存在"语义（恢复安全关键）**：`domains` 里**缺省**的域恢复时**原样保留本地数据**，不清空；只有**存在**（哪怕是 `[]`）的域才会被清空+覆盖。完整导出始终写齐全部 bundled 域（空的也写 `[]`），所以完整恢复语义不变；而自动备份只快照 `core + tasks`、`domains` 只含 `{ tasks }`，恢复它**不会**抹掉本地速记/健康数据。

**包含**：`categories`、`timeEntries`，以及 `domains` 下的 `tasks`、`quick_notes` 和 5 个健康域。

**不包含**（明确不导出）：

- `syncLog`（待同步队列，跨设备无意义）
- API URL、Token（**安全考虑，不可暴露**）
- UI 设置 / 同步 settings（例如睡眠分类）/ 临时计时器状态（`backup:"excluded"`）
- 自动备份 `autoBackups`（避免备份套备份）
- 机密域（未来的密码本）：在加密备份落地前**绝不进明文备份**；相关设计成熟后再沉淀到 evergreen 或 ADR。

> 注：速记除了进完整备份，仍保留独立的 `timedata.quick-notes.backup` 格式（按日期/范围导出，见 §1.5），作为"只导速记"的便捷通道；完整备份是它的超集，不是替代。

外部 Backup JSON 不保留旧格式兼容路径：当前格式用 `domains` map 承载普通域，旧的顶层 `tasks` 字段不再读取。浏览器本地 Dexie 的历史 `autoBackups` 记录仍允许缺少 `tasks`，读取时归一化为 `[]`。

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

`packages/client/src/quick-notes/` 还包含速记页交互与展示组件（如菜单、剪贴板、时间线窗口 Hook、搜索/高亮、上传状态、长文本折叠和 Markdown 安全渲染）；这些不是备份格式入口，不改变本节 JSON / Markdown 契约。

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

1. 同时读 Dexie `categories`、`timeEntries` 和 `tasks`。
2. 构造 `BackupDocument`（含 `timeFormat: "utc"`），`exportedAt` 用当前时间，`appVersion` 从 `import.meta.env.VITE_APP_VERSION` 读，缺省 `0.1.0`。
3. `device.deviceName` 默认 `"Web"`，可被参数覆盖（mobile 端会传 `"Android"` 等）。
4. **只构造 JS 对象**，不直接下载——下载是 UI 层用 `fileDownload.ts` 做的。

无副作用，可以反复调。

## 3. 校验（`validateBackup`）

恢复前必跑。`validateBackup` 用 shared 包的 `CategorySchema`、`TimeEntrySchema`、`TaskSchema` 与 `UtcIsoStringSchema` 严格校验分类、记录、任务和时间字段。正常通过 TimeData 客户端导出的备份文件不会受影响；手工编辑过的备份如果时间字段不带毫秒、不带 `Z` 或带时区偏移，会被拒绝，建议改成 `2026-05-19T03:00:00.000Z` 这种 `.sssZ` 格式后重试。任务记录经 `TaskSchema` 归一化，旧记录缺少 `completedCount`、`completedAt` 或 `tags` 时分别按 0、`null`、`[]` 恢复；`recurrence.count` 与 `recurrence.until` 同时存在会被拒绝。

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
| `INVALID_TASKS` | `tasks` 不是数组，或单条未通过 `TaskSchema` |
| `INVALID_TIME_FORMAT` | 备份缺少 `timeFormat: "utc"` |
| `INVALID_TIME_ENTRY_TIME` | 记录时间不是 UTC ISO，或 `endTime <= startTime` |
| `INVALID_CATEGORY_TREE` | 分类自引用、形成环，或超过两级分类树 |
| `DUPLICATE_CATEGORY_ID` | 分类 ID 重复 |
| `DUPLICATE_ENTRY_ID` | 记录 ID 重复 |
| `DUPLICATE_TASK_ID` | 任务 ID 重复 |
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
     tasks.clear()
     syncLog.clear()
     categories.clear()
     categories.bulkAdd(backup.categories)
     timeEntries.bulkAdd(backup.timeEntries)
     tasks.bulkAdd(backup.tasks)
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
- 自动备份记录恢复入口使用 `TimeData-before-auto-backup-restore` 文件名前缀。

### 4.2 下载实现（`fileDownload.ts`）

`downloadBackupFile()` 会根据运行环境选择落盘方式，所有调用方必须 `await`：

- **浏览器/PWA**：构造 Blob、创建 `<a download>` 并触发点击，1 秒后再 `URL.revokeObjectURL()`。锚点临时挂到 `document.body` 上以兼容 Firefox。
- **Capacitor Android**：用 `@capacitor/filesystem` 把 JSON 写入 `Directory.Documents`，再调用 `@capacitor/share` 让用户选择保存或分享目标（系统 Files、邮件、即时通讯等）。文件名前缀与浏览器侧一致。若用户取消分享会被静默吞掉，已经写盘的文件仍保留。

Phase 5.3 的人工验收清单里有“导出 + 恢复 Backup JSON”一步（见 `packages/mobile/README.md`）。修改这块代码后必须：

- 在 Web 端验收浏览器下载文件；
- 在 Android APK 上验收 `Filesystem.writeFile` + Share 流程；
- 执行 `pnpm --filter @timedata/mobile android:sync` 让新增的 Capacitor 插件落到 Android 工程。

## 5. 自动滚动备份（`autoBackup`）

`packages/client/src/backup/autoBackup.ts`：

- `createAutoBackup()` 把当前 `categories` + `timeEntries` + `tasks` 整盘存进 Dexie `autoBackups` 表；settings 和 quick notes 不进入自动滚动备份，分别走同步管线和独立速记备份恢复。如果最新一份自动备份的数据签名与当前数据相同，会跳过写入，避免连续同步把可恢复快照挤掉；签名使用按 `id` 稳定排序后的完整分类/记录/任务内容 JSON，确保数量和最新更新时间不变但字段内容不同的情况也会生成新快照，任务的 `completedCount`、`turn/turnAt`、`completedAt`、`tags`、`recurrence.count`、`recurrence.until` 都参与签名；最多保留 **7 份**（FIFO，按 `createdAt` 倒序）。
- `listAutoBackups()` 列出所有自动备份。

触发点在 UI/同步入口（`useSync.ts`、`SettingsDataPage.tsx` 等用户操作入口），不由 `autoBackup.ts` 自己定时调用。这是有意为之——避免后台调度让 IndexedDB 在不可预期的时间膨胀。

普通同步会先比较本地与云端的同步读数。若无需 push/pull，同步返回“无需同步”，不会创建自动备份；只有即将发生实际 push/pull/覆盖等可能改写数据的操作前才创建安全备份。任务变化会进入自动备份签名，因此只改任务也会生成新的本地安全快照。

自动备份记录有独立展示页（设置 → 数据设置 → 本地自动备份），每条记录显示创建时间和数据摘要（分类、时间记录、任务），并通过右侧“恢复”按钮执行恢复。它不是同步日志；同步日志/待同步队列仍分别属于 Dexie `syncLog` 和服务端 `sync_logs`。历史本地 `autoBackups` 记录如果没有 `tasks` 字段，读取时按空数组处理。

分类排序、重命名、一级分类颜色/一键配色、归档，以及分类详情页的通用分类字段更新后，本地 `autoBackups` 中同一 `Category.id` 的对应分类字段会跟随更新；已经导出到应用外部的 JSON 文件不会被自动修改。

**这层不会落到磁盘文件**——只在浏览器 IndexedDB 里。如果用户清浏览器数据就一起没了。这就是为什么仍然推荐用户定期手动导出 Backup JSON。

## 6. Server backup（服务端写入前）

`packages/server/src/sync/backup.ts` 的 `createServerBackup(operation)`：

- 在 `<DB_PATH>/../backups/` 下生成 `<operation>-<ISO 时间>.db` 文件。
- 用 `better-sqlite3` 的 `db.backup()` API（在线热备份，不阻塞写）。
- 普通增量 push 校验通过、写入前调一次（`operation = 'sync_push'`）。
- 如果 push 的 `baseSeq` 不是服务器当前可快进祖先、且云端在同一记录上已有更新，本地仍优先写入；写入前调一次 `operation = 'sync_local_wins'` 并标成受保护备份。
- 覆盖核心同步表的 force-push 写入前调一次（`operation = 'sync_force_push'`）。
- 创建完成后用 `setImmediate` 异步调用 `cleanupServerBackups()`；服务启动时也会跑一次 cleanup，避免长时间无 push 的实例积累旧备份。清理成功删除旧备份时输出 `[backup] cleanup removed old backups` 加结构化对象（`backupId`、`operation`、`removedCount`），清理失败时输出 `[backup] cleanup failed` 加对应错误对象，便于长期运行后定位磁盘或权限问题。

普通 push 的 `backup.id` 写进 `SyncPushResponse.backupId`；force-push 的 `backup.id` 写进 `SyncForcePushResponse.backupId`。事务失败时响应也带回备份 ID，方便运维拿到出问题前的现场。

**当前保留策略**：

- 受保护备份永不删除。
- 最近 15 天内的普通备份全保留。
- 超过 15 天后，按每 15 天窗口只保留最近一份普通备份。
- 发生本地覆盖远端、`sync_local_wins` 非快进覆盖、force-push 或其他需要留现场的场景时，会把对应备份标成受保护并额外写入原因与覆盖记录 ID。受保护备份的 `reason` 会区分 `local_override_overlap` 和 `local_wins_non_fast_forward`，方便排障时判断是时间段重叠覆盖还是 seq 非快进本地优先覆盖。

实现位置：`packages/server/src/sync/backup.ts` 的 `cleanupServerBackups()` 与 manifest 管理。`readBackupManifest()` 只把 manifest 不存在视为静默空状态；JSON 损坏、权限错误等其他读取失败会输出 `[backup] failed to read manifest`，但仍返回空 manifest，避免写入路径因观测元数据损坏而中断。

## 7. 改这块代码前的清单

- [ ] 跑 `packages/client/src/backup/*.test.ts`：导出、校验、恢复都有测试。
- [ ] 改 Backup JSON 字段：同步更新 `BackupDocument`、`exportBackup`、`validateBackup`、恢复入口、自动备份历史记录兼容和本文档。
- [ ] 改恢复语义（如改成"合并"或"自动 push 覆盖服务器"）：先看 ADR 0002，理解为什么恢复**不**自动覆盖服务器，再决定。
- [ ] 改 `validateBackup` 错误码：在 `BackupValidationErrorCode` 加新值，UI 提示文案要同步加。
