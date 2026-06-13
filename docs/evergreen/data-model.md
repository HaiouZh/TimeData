---
type: evergreen
title: 数据模型与契约
covers:
  - packages/shared/src/types.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/constants.ts
  - packages/server/src/db/schema.ts
  - packages/server/src/db/connection.ts
  - packages/server/src/db/reset.ts
  - packages/server/src/lib/db-rows.ts
  - packages/client/src/db/index.ts
  - packages/client/src/lib/quickNotes.ts
  - packages/client/src/quick-notes/**
  - packages/client/src/lib/settings/**
  - packages/client/src/lib/sleepCategorySetting.ts
  - packages/client/src/hooks/useCategories.ts
  - packages/client/src/lib/categorySort.ts
  - packages/client/src/lib/categoryColors.ts
last-reviewed: 2026-06-04
---

# 数据模型与契约

> 本文是跨端数据契约的"唯一真相"——客户端 Dexie、服务端 SQLite、CLI 看到的字段都来自这里。
> 想看静态类型，去 `packages/shared/src/types.ts`；想看运行时边界校验，去 `packages/shared/src/schemas.ts`。本文档解释**字段语义、约定、约束**。

## 1. 主表

| 实体 | TS 类型 | SQLite 表 | Dexie 表 |
|---|---|---|---|
| 分类 | `Category` | `categories` | `categories` |
| 时间记录 | `TimeEntry` | `time_entries` | `timeEntries` |
| 速记 | `QuickNote` | `quick_notes` | `quickNotes` |
| 同步设置 | `Setting` | `settings` | `settings` |
| 同步日志（客户端用） | `SyncLogEntry` | — | `syncLog` |

服务端还有两张辅助表：

| 实体 | SQLite 表 | 作用 |
|---|---|---|
| 服务端同步日志 | `sync_logs` | 记录每次 push/pull 的摘要、状态、备份信息和保留的 `reasonCode` 细节，供运维和排障查看 |
| 删除墓碑 | `sync_tombstones` | 记录已删除的 `time_entries.id` / `categories.id` / `quick_notes.id` / `settings.key` 与删除时间，用于按序拉取删除事件重放；不能按固定 TTL 直接清理 |
| 服务端同步序列 | `sync_seq` | 记录每次成功写入后的单调递增序号，用于 `sinceSeq` 拉取和 `baseSeq` 快进判断 |
| 服务端同步状态 | `sync_state` | 保存 `/api/sync/status` 的 commit hash、最新 seq、行数和最新更新时间摘要，避免每次 status 全量读取业务表 |
| 应用元数据 | `app_metadata` | 记录全局一次性迁移/重置标记，例如 `utc_reset_v1` |

客户端 Dexie 多一张：

| 实体 | Dexie 表 | 作用 |
|---|---|---|
| 自动备份 | `autoBackups` | 客户端本地的滚动备份，保留最近 7 份（见 `backup.md`） |

`settings` 是同步键值表，当前用于跨设备保存睡眠分类等用户设置。它和 categories/time_entries 走同一套 `syncLog → push → sync_seq → pull` 管线；服务端 `settings.key` 是主键，值是字符串，`updated_at` 参与 `/api/sync/status` 的 commit hash。客户端入口是 `packages/client/src/lib/settings/index.ts`，睡眠分类包装入口是 `packages/client/src/lib/sleepCategorySetting.ts`。

`quick_notes` 是聊天式速记表，核心表达“时间 + 文本”，可附带 `source` / `sourceLabel` 作为展示来源元数据，也可带 `pinned` 表示置顶状态。它和 `time_entries` 分表，不引用分类，也不产生时间段；查询、展示、导出按 `occurredAt`，同步按 `updatedAt` 与 `syncLog` / `sync_seq`。客户端入口是 `packages/client/src/lib/quickNotes.ts` 和 `packages/client/src/pages/QuickNotesPage.tsx`；`quickNotes.ts` 同时提供按日期/范围查询、只读窗口查询（最新、早于、晚于、有界窗口）和置顶列表查询，供连续时间线与置顶区使用。搜索入口在 `packages/client/src/quick-notes/searchQuickNotes.ts`，只读扫描 Dexie `quickNotes` 并按 `occurredAt` 倒序返回，不写 `syncLog`。独立导出/导入/删除入口在 `packages/client/src/quick-notes/`。

服务端后台洞察的 `Admin*Response` 类型也在 `packages/shared/src/types.ts`。这些类型是 `/api/admin/*` 中概览、记录、分类汇总、同步诊断、备份元数据、健康检查和基础分析的只读响应契约，不对应新表，也不增加写入路径。受控维护端点 `/api/admin/sync-logs` 操作既有 `sync_logs` 表，不属于 `Admin*Response` 契约。

代码入口：`packages/shared/src/types.ts`、`packages/server/src/routes/admin.ts`、`packages/client/src/lib/adminApi.ts`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx`

相关测试：`packages/server/src/routes/admin.test.ts`、`packages/client/src/lib/adminApi.test.ts`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.test.tsx`

## 2. `Category`（分类）

```ts
{
  id: string;
  name: string;
  parentId: string | null;   // null = 顶层分类
  color: string;             // CSS 颜色字符串，例如 "#7B68EE"
  icon: string | null;
  sortOrder: number;         // 同层级内排序（只在同一 parentId 下比较）
  isArchived: boolean;       // 软删除标记
  createdAt: string;         // ISO 字符串
  updatedAt: string;         // ISO 字符串，**同步冲突解决用这个比较**
}
```

约束：

- **两级**：要么 `parentId === null`（顶层），要么 `parentId` 指向另一个顶层分类。服务端会拒绝自引用和第三级分类；UI 和 CLI 也按两级假设处理（如 `categories/path` 是 `parent.name/child.name`）。**如未来加第三级**，至少 CLI 的 path 解析、统计页、备份校验都要改。
- **运行时字段约束**：跨边界 `CategorySchema` 要求 `id` / `name` 是 trim 后非空字符串，`parentId` 为非空字符串或 `null`，`color` 是 `#RRGGBB`，`icon` 为非空字符串或 `null`，`sortOrder` 是有限整数，`createdAt` / `updatedAt` 是带毫秒与 `Z` 的 UTC ISO 字符串。
- **同层级排序**：`sortOrder` 只表示同一个 `parentId` 下的顺序。分类管理页拖拽排序只允许一级分类之间重排，或同一个父分类下的子分类之间重排；保存时会更新变化项的 `sortOrder` / `updatedAt` 并写入 `syncLog`。客户端入口是 `packages/client/src/pages/settings/SettingsCategoriesPage.tsx`、`packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx`、`packages/client/src/components/SortableCategoryItem.tsx`、`packages/client/src/hooks/useCategories.ts` 和 `packages/client/src/lib/categorySort.ts`；相关测试是 `packages/client/src/pages/settings/SettingsCategoriesPage.test.tsx`、`packages/client/src/pages/settings/SettingsCategoryDetailPage.test.tsx`、`packages/client/src/lib/categorySort.test.ts`、`packages/client/src/hooks/useCategories.test.ts`。`useCategories()` 在内部用 `categoryById` / `childrenByParentId` Map 缓存查找，`getCategoryPath` / `getCategoryColor` / `getChildren` 都是 O(1)，时间轴和统计页因此免去 O(n²) 扫描。
- **名称可改、身份不变**：`name` 是当前展示名，`id` 才是分类身份。新增分类和重命名分类都会在客户端 hook 层 trim 名称并拒绝空名；同层级未归档分类重名也会被拒绝。重命名分类只更新 `name` / `updatedAt` 并写 `syncLog` update，不迁移 `TimeEntry.categoryId`，历史记录按当前名称展示。分类管理页会拒绝同层级未归档分类重名，并同步更新本地 `autoBackups` 里同 ID 分类的可见字段。
- **颜色属于一级分类**：一级分类的 `color` 用 `#RRGGBB` 格式展示和同步；子分类沿用父分类颜色，不单独改色。客户端颜色入口是 `packages/client/src/pages/settings/SettingsCategoriesPage.tsx`、`packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx`、`packages/client/src/hooks/useCategories.ts` 和 `packages/client/src/lib/categoryColors.ts`；单个改色和一键配色都会更新变化项的 `color` / `updatedAt` 并写 `syncLog` update。一键配色只作用于未归档一级分类，并按当前一级分类排序循环应用预设色板。相关测试是 `packages/client/src/lib/categoryColors.test.ts`、`packages/client/src/hooks/useCategories.test.ts`、`packages/client/src/pages/settings/SettingsCategoriesPage.test.tsx`、`packages/client/src/pages/settings/SettingsCategoryDetailPage.test.tsx`。
- **归档与直接删除不同**：归档保留分类行，只把 `isArchived` 设为 `true`，更新 `updatedAt`，并写入 `syncLog` update 后通过 `categories/update` 同步；客户端分类列表默认隐藏归档分类。归档写入入口是 `packages/client/src/hooks/useCategories.ts` 导出的 `archiveCategory()`，`useCategories()` 仍把同名 mutation 暴露给页面使用。
- **直接删除是真删除**：分类管理页允许删除一级分类或子分类。删除一级分类会级联删除其子分类和这些分类下的 `TimeEntry`；删除子分类会删除该子分类及其记录。客户端会为被删记录和分类写 `syncLog` delete，并在 Dexie transaction 结束后显式确认已解析到删除影响，避免事务回调异常时返回不完整结果；服务端收到 `categories/delete` 后真删分类及后代，并写 `categories` tombstone，供其他设备拉取删除事件。客户端入口是 `packages/client/src/hooks/useCategories.ts`，服务端入口是 `packages/server/src/sync/resolver.ts`；相关测试是 `packages/client/src/hooks/useCategories.test.ts`、`packages/client/src/sync/engine.test.ts`、`packages/server/src/routes/sync.test.ts`。
- **首次启动播种**：服务端 `initializeDatabase()` 检测到 `categories` 为空时，插入 `createDefaultCategories()` 的默认值；客户端 `seedDefaultCategories()` 同理。两端用同一份 `DEFAULT_CATEGORIES` 常量。

## 3. `TimeEntry`（时间记录）

```ts
{
  id: string;
  categoryId: string;
  startTime: string;   // ISO 字符串
  endTime: string;     // ISO 字符串，必须 > startTime
  note: string | null;
  createdAt: string;
  updatedAt: string;
}
```

约束（**服务端权威**，见 `packages/server/src/sync/validation.ts`）：

- `endTime > startTime`，否则 `invalid_time_range`。运行时 `TimeEntrySchema` 在 shared 边界也会要求 `startTime` / `endTime` / `createdAt` / `updatedAt` 是带毫秒与 `Z` 的 UTC ISO 字符串，并在 schema 层拒绝 `endTime <= startTime`。
- `categoryId` 必须存在于 `categories` 表（同一批 push 里同时新增的分类也算存在）。
- 引用的分类不能是 archived，否则 `archived_category`。
- 同 `id` 之外的任何记录，时间段不能与本记录重叠（半开区间 `[start, end)`），否则 `overlap`。
- 删除：服务端真删行，并往 `sync_tombstones` 写一条墓碑。

## 4. `QuickNote`（速记）

```ts
{
  id: string;
  text: string;
  occurredAt: string; // 业务发生时间
  createdAt: string;  // 系统创建时间
  updatedAt: string;  // 编辑/同步时间
  source?: "user" | "agent";
  sourceLabel?: string;
  pinned?: boolean;
}
```

约束：

- `text` 保存前 trim，trim 后不能为空；运行时 `QuickNoteSchema` 会拒绝空文本。
- `occurredAt` / `createdAt` / `updatedAt` 都必须是严格 UTC ISO 字符串（带毫秒和 `Z`）。
- `occurredAt` 是用户看到、按天查询和导出的业务时间；`createdAt` 只表示系统创建时间，不能拿来做速记的业务排序。
- 客户端聊天时间线用 `occurredAt` 作为窗口游标，窗口查询只读 Dexie，不写 `syncLog`；新增、编辑、删除仍分别走 `addQuickNote` / `updateQuickNote` / `deleteQuickNote`。
- 客户端搜索用空格分词 AND 与不区分大小写子串匹配，只读扫描 Dexie `quickNotes`，不新增索引、不缓存、不写 `syncLog`；结果按 `occurredAt` 倒序展示，并用纯文本 `<mark>` 高亮命中词。
- 速记正文的存储契约始终是原始 `text` 字符串；客户端展示层可以按保守启发式安全渲染 Markdown，也可以折叠长文本，但导出、复制、编辑和同步都继续使用原文。
- 单条上传状态不是 `QuickNote` 字段，不落库到速记本身；客户端展示层只读 `syncLog(tableName="quick_notes", synced=0)` 推导待上传 ID，显示为时钟或单勾。
- `updatedAt` 用于导入合并和同步 LWW 判断；不强制 `updatedAt >= createdAt`，避免历史导入和设备时钟漂移造成额外失败。
- `source` 是来源标记，缺省等同用户自记；`source="agent"` 表示由授权 agent 经服务端受控 API 投递。`sourceLabel` 是展示标签（最长 64 字符），例如 agent 名称或任务名。它们只影响展示：普通速记气泡保持紧凑灰底，agent 速记气泡用深蓝底、弱蓝边框和来源标签区分，点击/焦点态仍复用同一个绿色外层状态；它们不参与时长统计、分类统计或客户端本地 content hash 对齐判定。
- `pinned` 是跨端同步的置顶状态，缺省或 `false` 都等同未置顶。置顶不改变 `occurredAt`，不影响日期范围查询语义；速记页会把置顶记录挂到顶部 header 的钉子按钮里展开，并从主时间线过滤，避免重复展示。切换置顶会更新 `updatedAt` 并写 `syncLog("quick_notes", id, "update")`。
- `pinned` 会参与客户端本地 content hash 与服务端同步内容摘要，因为它改变用户看到的时间线分区；`source` / `sourceLabel` 仍按展示元数据处理，不参与客户端本地 content hash。
- `QuickNote` 不引用 `Category` 或 `TimeEntry`，不参与分类存在性、archived 分类、时间段重叠、时间环、时长统计或分类统计。
- SQL 表名是 `quick_notes`，字段是 `occurred_at` / `created_at` / `updated_at` / `source` / `source_label` / `pinned`；`pinned` 是 `INTEGER NOT NULL DEFAULT 0`，映射到 JS 侧可选 boolean。Dexie 表名是 `quickNotes`，索引是 `id, occurredAt, updatedAt`。`source` / `sourceLabel` / `pinned` 都不是索引字段，客户端 Dexie 无需升版本；服务端旧库启动时通过幂等 `ALTER TABLE` 补列。
- `POST /api/quick-notes` 是授权 agent 投递速记的服务端写接口：请求只接受 `text`、可选 `sourceLabel` 和可选 `occurredAt`，服务端生成 `id` / `createdAt` / `updatedAt`，强制 `source="agent"`，再构造 `quick_notes/create` 变更走 `applyChange()` 与 `sync_seq`。

代码入口：`packages/shared/src/schemas.ts`、`packages/client/src/lib/quickNotes.ts`、`packages/client/src/pages/QuickNotesPage.tsx`、`packages/client/src/quick-notes/useQuickNoteTimeline.ts`、`packages/client/src/quick-notes/searchQuickNotes.ts`、`packages/client/src/quick-notes/searchTerms.ts`、`packages/client/src/quick-notes/highlightMatches.ts`、`packages/client/src/quick-notes/NoteBubble.tsx`、`packages/client/src/quick-notes/QuickNoteContent.tsx`、`packages/client/src/quick-notes/QuickNoteActionMenu.tsx`、`packages/server/src/db/schema.ts`、`packages/server/src/lib/db-rows.ts`、`packages/server/src/routes/quick-notes.ts`

相关测试：`packages/shared/src/schemas.test.ts`、`packages/client/src/lib/quickNotes.test.ts`、`packages/client/src/pages/QuickNotesPage.test.tsx`、`packages/client/src/quick-notes/useQuickNoteTimeline.test.tsx`、`packages/client/src/quick-notes/searchQuickNotes.test.ts`、`packages/client/src/quick-notes/searchTerms.test.ts`、`packages/client/src/quick-notes/highlightMatches.test.ts`、`packages/client/src/quick-notes/NoteBubble.test.tsx`、`packages/client/src/quick-notes/QuickNoteContent.test.tsx`、`packages/client/src/quick-notes/QuickNoteActionMenu.test.tsx`、`packages/client/src/quick-notes/looksLikeMarkdown.test.ts`、`packages/server/src/db/schema.test.ts`、`packages/server/src/lib/db-rows.test.ts`、`packages/server/src/routes/quick-notes.test.ts`

## 5. `SyncLogEntry`（客户端同步日志）

只存在于客户端 Dexie：

```ts
{
  id: string;
  tableName: "categories" | "time_entries" | "settings" | "quick_notes";
  recordId: string;
  action: "create" | "update" | "delete";
  timestamp: string;   // ISO，写日志当时的时间
  synced: 0 | 1;        // 0 = 待同步，1 = 已同步
}
```

客户端 Dexie `syncLog` 使用 `[tableName+synced]` 复合索引。新写入路径（`recordSyncLog`、分类批量写日志等）写 `synced: 0`，标记完成写 `synced: 1`；运行时 `SyncLogEntrySchema` 只接受 `0 | 1`。

每次本地写入同步实体（`categories` / `timeEntries` / `settings` / `quickNotes`）都要调 `recordSyncLog()` 或等价批量写入追一条。**修改同步实体却忘了写 syncLog 是常见 bug**。实体写入与对应 `syncLog` 写入必须在同一个 Dexie transaction 内完成；如果同步日志写入失败，实体变更也要回滚，避免本地数据与待同步队列不一致。

## 6. 同步推送：`SyncChange` / `SyncPushOutcome`

`SyncChange` 是按表和动作区分的联合类型；运行时 schema 在 `packages/shared/src/schemas.ts`，服务端 `/api/sync/push` 入口和客户端 `/api/sync/pull` 响应入口都会校验这个契约。

```ts
type SyncChange =
  | { tableName: "categories"; action: "create" | "update"; recordId: string; data: Category; timestamp: string }
  | { tableName: "categories"; action: "delete"; recordId: string; data: null; timestamp: string }
  | { tableName: "time_entries"; action: "create" | "update"; recordId: string; data: TimeEntry; timestamp: string }
  | { tableName: "time_entries"; action: "delete"; recordId: string; data: null; timestamp: string }
  | { tableName: "settings"; action: "create" | "update"; recordId: string; data: Setting; timestamp: string }
  | { tableName: "settings"; action: "delete"; recordId: string; data: null; timestamp: string }
  | { tableName: "quick_notes"; action: "create" | "update"; recordId: string; data: QuickNote; timestamp: string }
  | { tableName: "quick_notes"; action: "delete"; recordId: string; data: null; timestamp: string };
```

服务端对每条 change 输出一个 `SyncPushOutcome`：

```ts
{
  tableName, recordId, action,
  status: "accepted" | "rejected" | "conflict";
  reasonCode: SyncPushReasonCode;
  message: string;
  incomingTimestamp: string;
  serverUpdatedAt?: string;
  overriddenRecordIds?: string[];
  backupId?: string;
}
```

`SyncPushReasonCode` 是**封闭白名单**：

| reasonCode | 含义 | 给谁看 |
|---|---|---|
| `applied` | 接受并已写入 | 客户端：标记本地 syncLog 为 synced |
| `missing_payload` | create/update 没带 data | 客户端 bug，提示开发者 |
| `invalid_shape` | 字段类型错 | 客户端 bug |
| `id_mismatch` | `data.id !== recordId` | 客户端 bug |
| `invalid_time_range` | `endTime <= startTime` | 数据问题，需用户修 |
| `missing_category` | 分类不存在 | 数据问题（极少：分类被另一端删了） |
| `archived_category` | 分类已 archived | 用户问题 |
| `overlap` | 时间段重叠 | 用户问题（多设备并行编辑） |
| `server_version_newer_or_same` | 服务器版本 ≥ 客户端 | 兼容保留码，当前本地优先写入路径不再靠它拒绝 |
| `foreign_key_failed` | 外键约束失败 | 数据问题 |

**修改 `SyncPushReasonCode` 等于改公开契约**：客户端 UI、错误提示、CLI 错误码处理都依赖这个枚举。新增枚举值必须同步更新 client 的处理。

### 6.1 全量同步兜底契约

全量推送兜底复用完整的 `Category[]`、`TimeEntry[]`、`QuickNote[]` 和可选 `Setting[]` 请求体。服务端在导入前校验分类/记录 ID 唯一、父分类存在、记录引用分类存在、时间范围合法、记录之间不重叠、速记 ID 唯一；`quickNotes` 缺省时按空数组兼容旧客户端，`settings` 缺省时按旧客户端兼容路径保留服务端现有设置，只有请求显式带 `settings` 时才清空重建设置表。

相关共享类型只描述同步摘要和确认流程：

- `SyncDatasetStatus`：分类数、时间记录数、速记数、最新更新时间；`contentHash` 是业务内容稳定哈希，用于识别数量和时间摘要不变但内容不同的状态；可选 `latestSeq` 表示服务端当前最新 `sync_seq`。
- `SyncStatusResponse`：服务端摘要 + `serverTime`；`/api/sync/status` 当前返回 `contentHash` 与 `latestSeq`。
- `SyncForcePushPrepareRequest` / `SyncForcePushPrepareResponse`：客户端提交本地摘要，服务端返回短时确认 token、过期时间、确认短语和当前服务端摘要。
- `SyncForcePushRequest` / `SyncForcePushResponse`：客户端提交完整数据；服务端返回导入数量（含 `importedQuickNotes`）、服务器备份 ID、服务器时间和最新 `latestSeq`。
- `SyncHealthReport`：客户端比较本地摘要和服务端摘要后的诊断结果，不会自动触发全量拉取或推送。

### 6.1.1 数据重置确认契约

`DataResetPrepareResponse` 描述 `/api/data/reset/prepare` 的响应：服务端返回短时 `confirmToken`、固定确认短语 `RESET_DATA` 和 `expiresAt`。真正执行 `POST /api/data/reset` 时必须同时提交 token 与确认短语；服务端会先创建受保护备份，再重置为默认分类。这个契约只服务人工维护入口，不是 AI/脚本日常写入路径。

### 6.2 增量同步序列契约

服务端 `sync_seq` 是同步 cursor 的权威来源：每次 `applyChange()` 成功写入同步实体后追加一行；CLI `log` 成功创建记录后也追加 `time_entries/create` 序列；`force-push` 全量覆盖服务器时清空并按导入后的 categories/timeEntries/quickNotes/settings 重建序列。每次序列推进都会刷新 `sync_state` 的 commit hash，供 `/api/sync/status` 轻量读取。

共享契约：

- `SyncPushRequest.baseSeq?: number | null`：客户端上次观察到的服务端序列，用来判断本次 push 相对云端是否可快进；运行时 schema 只接受有限非负整数、`null` 或缺省。
- `SyncPullRequest.sinceSeq: number | null`：客户端请求拉取某个服务端账本编号之后的变更，0 或 `null` 表示全量；这是 pull 唯一的 cursor（timestamp cursor 已退役，见 ADR 0012）；运行时 schema 只接受有限非负整数或 `null`，缺字段即 400。
- `SyncPullResponse.latestSeq?: number | null`：服务端当前最新序列；客户端只前进、不回退本地 `timedata_last_synced_seq`；运行时 schema 只接受有限非负整数、`null` 或缺省。
- `SyncDatasetStatus.latestSeq?: number | null`：服务端状态摘要里的当前最新序列，用于普通同步 meta 预检和诊断展示，避免为了拿序列再多一次 round trip；meta no-op 同步会用它推进本地 `timedata_last_synced_seq`；状态响应里的 `categoryCount` / `entryCount` / `quickNoteCount` 同样是有限非负整数。

`sync_seq` 不改变 `Category` / `TimeEntry` / `QuickNote` / `Setting` 字段，也不是用户可见历史记录；它只表示服务端接收并落库的同步顺序。

## 7. 时间字段约定

### 7.1 `updated_at` 语义

服务端写入 `categories.updated_at` / `time_entries.updated_at` / `quick_notes.updated_at` / `settings.updated_at` 时使用 `SyncChange.timestamp`，也就是客户端写 `syncLog` 的时刻；不使用 `change.data.updatedAt`，也不使用服务器当前时间。这样同一条记录在多端同步时，服务端落库顺序由同步日志时间决定，避免 payload 内部字段和同步意图时间不一致。

代码入口：`packages/server/src/sync/resolver.ts` 的 `applyCategoryChange` / `applyEntryChange` / `applyQuickNoteChange` / settings 分支。

相关测试：`packages/server/src/sync/resolver.test.ts` 的 `uses change timestamp instead of payload updatedAt for server updated_at`。

### 7.2 时间格式现状

**时间字段已统一为 UTC（2026-05-14 完成）**：所有时间字段一律使用 UTC ISO 字符串（带 `Z`）存储和传输；展示时再转本地时区。

具体行为：

- Dexie / SQLite 里所有 `*_at` 字段是 `new Date().toISOString()` 的产物，**带 Z**（UTC）。
- `TimeEntry.startTime` / `endTime` 也是 UTC ISO 字符串（带 `Z`）。
- 客户端表单输入本地时间 → 保存前用 `localDateTimeToUtc()` 转 UTC 写入；加载已有记录时用 `utcToLocalDateTime()` 转本地时间展示（`packages/client/src/pages/EntryPage.tsx`）。
- 服务端同步校验要求 `startTime` / `endTime` 必须是严格 `YYYY-MM-DDTHH:mm:ss.sssZ` 格式（`UtcIsoStringSchema` / `isUtcIso()`），否则返回 `invalid_shape`（`packages/server/src/sync/validation.ts`）。
- CLI 输入仍是本地日期和 `HH:mm`，服务端在 `entry-service.ts` 内部转换：写入时 `localDateTimeToUtc()` 转为 UTC 存储，返回时 `utcToLocalDateTime()` 转回本地时间给 CLI 展示。
- 展示层函数（`formatTime`、`formatDateTimeRange`、`buildTimeSlots`）统一接受 UTC 输入，内部转换后展示本地时间（`packages/client/src/lib/time.ts`）。

迁移方式：数据重置（不转换历史数据）。服务端首次启动检测 `app_metadata.utc_reset_v1` 标记，若不存在则清空旧业务数据并写入默认分类；客户端 Dexie 当前是 v2 schema，v2 新增 `settings` store。Backup 使用当前唯一格式 `timedata.backup`（`timeFormat: "utc"`）。

## 8. 默认分类预设

定义在 `packages/shared/src/constants.ts` 的 `DEFAULT_CATEGORIES`，五个顶层（睡眠 / 生存 / 投资 / 享乐 / 运转），每个有 1-6 个子分类。详见 [`domain/categories-preset.md`](./domain/categories-preset.md).

`createDefaultCategories(timestamp?)` 同时给客户端和服务端用，确保两端的"出厂状态"一致。

## 9. SQL 字段映射表

写新路由或新同步逻辑时常需要这张表。SQL 列名（snake_case）↔ JS 字段（camelCase）：

| SQL 列 | JS 字段 |
|---|---|
| `parent_id` | `parentId` |
| `category_id` | `categoryId` |
| `start_time` | `startTime` |
| `end_time` | `endTime` |
| `occurred_at` | `occurredAt` |
| `source_label` | `sourceLabel` |
| `pinned` | `pinned`（SQL 0/1，JS 可选 boolean） |
| `sort_order` | `sortOrder` |
| `is_archived` | `isArchived`（SQL 0/1，JS boolean） |
| `created_at` | `createdAt` |
| `updated_at` | `updatedAt` |

映射代码散落在各路由里（`packages/server/src/routes/*`），没有集中的 mapper。改字段名需要全文搜索。

## 10. Dexie schema

`packages/client/src/db/index.ts` 当前维护三个 Dexie 版本声明；v3 是当前 schema，新增 `quickNotes`，并保留旧表声明以支持本地升级：

```ts
db.version(3).stores({
  categories: "id, parentId, sortOrder",
  quickNotes: "id, occurredAt, updatedAt",
  timeEntries: "id, categoryId, startTime, endTime",
  syncLog: "id, tableName, recordId, synced, [tableName+synced]",
  autoBackups: "id, createdAt",
  settings: "key",
});
```

v1 是初始业务表，v2 增加 `settings`，v3 增加 `quickNotes`。`QuickNote.pinned` 不建索引，因此作为普通字段随记录存储，不需要新增 Dexie 版本。`resetLocalDataToDefaults()` 当前只重置分类、时间记录、settings 与对应非速记 `syncLog`，不会清空 `quickNotes`；速记有独立导入/导出/删除入口。

**SQLite 这边**目前的迁移机制是 `CREATE TABLE IF NOT EXISTS`——只能加表，**不能改已有列定义**。改 schema 时需要：
1. 加新表 / 加新列（用 `ALTER TABLE ... ADD COLUMN`）— 现有数据自动兼容。
2. 改已有列含义 / 类型 — 当前没有迁移框架，需要写一次性迁移代码（读旧表、转换、写新表、删旧表）。**不要原地改 schema 字符串**——已部署的实例不会重建。

🟡 *待优化项：未来引入正式的 SQLite 迁移机制（按版本号执行 up 脚本）*。

## 11. ID 约定

- `Category.id`：默认分类用人写的字符串 ID（如 `cat-sleep-sleep`），用户新建用 UUID。
- `TimeEntry.id`：始终是 UUID。
- `QuickNote.id`：始终是 UUID。
- 客户端、服务端、CLI 都不应分配 ID 然后期望另一端"修正"——**ID 是不可变的**。

## 12. 服务端后台洞察响应

`Admin*Response` 仍然是只读契约，不引入新表，但字段语义已经扩展到同步保护备份和最近问题列表。

### `AdminSyncResponse`

```ts
{
  logs: AdminSyncLogRow[];
  recentRejectedCount: number;
  recentConflictCount: number;
  recentIssues: AdminSyncIssueRow[];
}
```

- `recentIssues` 里会直接列出最近 20 条真正需要人看的项：`rejected`、`conflict` 或带 `overriddenRecordIds` 的 accepted 项。
- 每条 issue 都带 `backupId`，如果这次 push 触发了本地覆盖远端，对应备份会被标成受保护。

### `AdminBackupRow`

```ts
{
  id: string;
  fileName: string;
  operation: string;
  sizeBytes: number;          // 有限非负整数
  createdAt: string;
  protected: boolean;
  reason: string | null;
  retention: "recent" | "snapshot" | "protected" | "deletable";
  relatedSyncLogId: number | null; // 有限非负整数或 null
}
```

- `protected=true` 表示这个备份不参与自动清理。
- `id`、`fileName`、`operation` 在运行时 schema 中必须是非空字符串；`sizeBytes` 与 `relatedSyncLogId`（非 `null` 时）必须是有限非负整数。
- `reason` 主要用于说明为什么被保护，例如 `local_override_overlap`。
- `retention` 是 UI 展示用的分类，不是新表字段。
- `relatedSyncLogId` 用于把备份和服务端同步日志串起来。

代码入口：`packages/server/src/routes/admin.ts`、`packages/server/src/sync/backup.ts`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx`

相关测试：`packages/server/src/routes/admin.test.ts`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.test.tsx`
