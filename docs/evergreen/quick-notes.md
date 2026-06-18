---
type: evergreen
title: 速记
covers:
  - packages/shared/src/types.ts:QuickNote
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/syncDomains.ts
  - packages/client/src/db/index.ts
  - packages/client/src/pages/QuickNotesPage.tsx
  - packages/client/src/lib/quickNotes.ts
  - packages/client/src/lib/quickNoteDisplay.ts
  - packages/client/src/quick-notes/**
  - packages/client/src/sync/clientDomains.ts
  - packages/server/src/db/schema.ts
  - packages/server/src/lib/db-rows.ts
  - packages/server/src/lib/quick-note-service.ts
  - packages/server/src/routes/quick-notes.ts
  - packages/server/src/sync/domains.ts
  - packages/cli/src/commands/notes.ts
  - packages/cli/src/lib/format.ts
last-reviewed: 2026-06-18
---

# 速记

> 速记域覆盖 `quick_notes` 表、聊天式速记页、独立导入导出、CLI 只读查询和授权 agent 投递。
> 速记页也有“存待办/打点”入口，但那两个动作分别写 `tasks` 与 `time_entries`，不属于 `quick_notes` 数据域。

## 承上启下

- 上游：用户在速记页新增/编辑/置顶/删除；CLI 只读查询；授权 agent 通过 server API 投递。
- 下游：Web 本地写 `quickNotes` + `syncLog(tableName="quick_notes")`；agent 投递直接走 server `applyChange()` + `sync_seq`；其他设备通过 [sync](sync.md) 拉取。
- 契约：字段 schema 见本文 §2；跨域时间、ID 和 SQL/Dexie 映射见 [data-model](data-model.md)。
- 邻居：[todo](todo.md) 处理 composer 的“存待办”；[timeline](timeline.md) 与 [categories-settings](categories-settings.md) 处理“打点到现在”；[backup](backup.md) 处理全量备份。

## 1. 数据流

### 1.1 Web 本地写入

新增速记时，`QuickNotesPage` trim 输入并调用 `addQuickNote(text)`。`addQuickNote` 生成 UUID，默认 `occurredAt === createdAt`，通过 `QuickNoteSchema` 解析后，在同一个 Dexie transaction 内写 `quickNotes` 与 `syncLog("quick_notes", id, "create")`。

编辑、置顶、取消置顶、单条删除、批量删除和范围删除都遵守同一边界：业务表 mutation 与 `syncLog` 追写同事务完成。置顶记录由 `listPinnedQuickNotes()` 读出挂在顶部钉子区，主时间线过滤 pinned 记录，避免重复展示。

导出是速记独立格式 `timedata.quick-notes.backup`，`timeFormat: "utc"`；Markdown 只是分享/展示产物，不是导入契约。导入按 id 合并：本地不存在则 insert，存在且 incoming `updatedAt` 更新才覆盖，否则 kept。

### 1.2 CLI 只读查询

`timedata notes` 只发：

```text
GET /api/quick-notes?...&format=cli
```

它支持 `--date`、`--from/--to`、`--recent --limit`，默认日期为应用时区的今天。响应只包含 `id`、`occurredAt`、`occurredLocal` 和 `text`，格式化为 `YYYY-MM-DD HH:mm  text`。CLI 没有 quick note 写命令。

### 1.3 Agent 投递

`POST /api/quick-notes` 挂在普通 `/api/*` Bearer auth 后，请求只接受 `text`、可选 `sourceLabel` 和可选 `occurredAt`。服务端拒绝 caller-supplied `source`，自己生成 `id/createdAt/updatedAt`，强制 `source="agent"`，构造 `quick_notes/create` 的 `SyncChange`，走 `applyChange()` 写 SQLite + `sync_seq`，再 `notifySyncChange(getLatestSeq())`。

这仍是“服务端受控 API”写入边界，不是直接编辑 SQLite / IndexedDB / 备份文件。

### 1.4 同步下发

客户端 push 从本地 `syncLog` 编 `quick_notes/create|update|delete`；quick_notes 不注入分类依赖。服务端对 quick_notes 做 shared schema/id 通用校验，不做分类、重叠或时间环校验。pull 时按 `sinceSeq` 读 `sync_seq`，把 upsert 转成 update change；客户端 LWW apply 若发现同一 note 本地仍有未同步变更会跳过，否则写 Dexie。

## 2. Schema / 契约

```ts
type QuickNote = {
  id: string;
  text: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  source?: "user" | "agent";
  sourceLabel?: string;
  pinned?: boolean;
};
```

- `id`、`text` 是 trim 后非空字符串；`sourceLabel` 最长 64。
- `occurredAt` / `createdAt` / `updatedAt` 都是严格 UTC ISO。
- `occurredAt` 是业务发生时间：按天查询、窗口游标、展示分组和导出排序都用它；`createdAt` 只表示系统创建时间。
- `source` 缺省等同用户自记；`source="agent"` 表示授权 agent 投递。`source` / `sourceLabel` 只影响展示。
- `pinned` 缺省或 `false` 等同未置顶；它会改变用户可见分区，因此参与本地 content hash 与同步摘要。
- SQL 表名是 `quick_notes`，字段是 `occurred_at`、`created_at`、`updated_at`、`source`、`source_label`、`pinned`；`pinned` 是 0/1。
- Dexie 表名是 `quickNotes`，索引是 `id, occurredAt, updatedAt`；`source` / `sourceLabel` / `pinned` 不是索引字段。

## 3. 关键不变量 / 坑 / 红线

- `quick_notes` 不引用 `categories` 或 `time_entries`，不参与分类存在性、归档分类、时间段重叠、时间环、时长统计或分类统计。
- 速记正文存储契约始终是原始 `text`。展示层可在保守识别结构语法后用 `react-markdown + remark-gfm + rehype-sanitize` 安全渲染；搜索结果始终走纯文本高亮。
- 搜索是只读 Dexie 扫描：200ms debounce、空格分词、去重、小写 AND 子串匹配，按 `occurredAt` desc / `id` desc 返回，不写 `syncLog`。
- 单条上传状态不是 `QuickNote` 字段。页面只读 `syncLog(tableName="quick_notes", synced=0)` 推导时钟/单勾。
- composer 左侧“待办”写 `tasks`；顶部“打点”写 `time_entries`，分类来自 `punch.categoryId.v1`。二者只是速记页的捕捉入口，不新增写入通道，也不让 quick_notes 拥有时间记录或分类契约。
- `POST /api/quick-notes` 强制 `source="agent"`；agent 不能伪装成 user。

## 4. 模块速查

| 关注点 | 入口 |
|---|---|
| 类型 / schema | `packages/shared/src/entitySchemas.ts`、`packages/shared/src/types.ts` |
| 客户端模型 | `packages/client/src/lib/quickNotes.ts`、`packages/client/src/lib/quickNoteDisplay.ts` |
| 页面与组件 | `packages/client/src/pages/QuickNotesPage.tsx`、`packages/client/src/quick-notes/**` |
| 独立导入导出 | `exportQuickNotes.ts`、`importQuickNotes.ts`、`schema.ts` |
| 搜索 / 高亮 / Markdown | `searchQuickNotes.ts`、`searchTerms.ts`、`highlightMatches.ts`、`QuickNoteContent.tsx` |
| 服务端 API | `packages/server/src/routes/quick-notes.ts`、`packages/server/src/lib/quick-note-service.ts` |
| 服务端映射 / 同步域 | `packages/server/src/db/schema.ts`、`packages/server/src/lib/db-rows.ts`、`packages/server/src/sync/domains.ts` |
| CLI | `packages/cli/src/commands/notes.ts`、`packages/cli/src/lib/format.ts` |
| 代表测试 | `packages/client/src/lib/quickNotes.test.ts`、`packages/client/src/pages/QuickNotesPage.test.tsx`、`packages/client/src/quick-notes/*.test.ts*`、`packages/server/src/routes/quick-notes.test.ts`、`packages/cli/src/commands/notes.test.ts` |

## 深水细节

聊天时间线、置顶抽屉、长文本折叠、Markdown 展示和批量操作都属于速记页内增长点。若某一块超过 [_docs-guide](_docs-guide.md) 的毕业阈值，再外提到 `docs/evergreen/quick-notes-*.md` 或域内子文档。
