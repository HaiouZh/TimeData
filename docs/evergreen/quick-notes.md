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
contracts:
  - packages/shared/src/types.ts:QuickNote
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/syncDomains.ts
  - packages/server/src/sync/domains.ts
last-reviewed: 2026-08-03
---

# 速记

> 聊天式速记域：`quick_notes` 以「时间 + 文本」为核心，可带来源/置顶元数据，不引用分类/时间记录，不参与时长统计。
> 讲什么：QuickNote 字段契约、聊天时间线、置顶、搜索、Markdown 渲染、导入/导出、agent 投递、CLI 只读、捕捉中心角色。
> 不讲什么：同步账本（见 [sync](sync.md)）、备份格式（见 [backup](backup.md)）、打点写 time_entries（见 [timeline](timeline.md)）、存待办写 tasks（见 [todo](todo.md)）。

## 承上启下

- **上游**：用户在 `QuickNotesPage` 自记/编辑/置顶/删除；授权 agent 经 `POST /api/quick-notes` 投递 `source="agent"`；CLI `timedata notes` 只读查询。
- **下游**：本地 mutation 经 `syncLog(tableName="quick_notes")` → [sync](sync.md) 推送 → 服务端通用 LWW 域 + `sync_seq` → 其他设备拉取。独立备份格式 `timedata.quick-notes.backup`（见 [backup](backup.md)）。
- **契约**：`QuickNote` 字段 schema 见本文 §2，定义在 `entitySchemas.ts:QuickNoteSchema`（`schemas.ts` re-export）；跨域约定见 [data-model](data-model.md)。
- **邻居**：[todo](todo.md)（composer「存待办」调 `addTask`）、[tracks](tracks.md)（TrackStep 复用 `source/sourceLabel` 的人/agent 来源口径）、[timeline](timeline.md)（composer「打点」建 time_entry，分类来自 [categories-settings](categories-settings.md) 的打点分类设置）、[sync](sync.md)。

## 1. 数据流（本域端到端，跨包）

### 1.1 Web 端写入

所有本地 mutation 都在 `db.transaction("rw", db.quickNotes, db.syncLog, ...)` 同事务追写 `syncLog(tableName="quick_notes")`（`lib/quickNotes.ts`）：

- **新增** `addQuickNote(text)`：生成 UUID，`normalizeText` trim 后非空，`occurredAt` 缺省 = `createdAt` = now；不设 `source/sourceLabel/pinned`（用户自记 source 缺省等同 user）。
- **编辑** `updateQuickNote(id, {text})`：只改 `text/occurredAt/updatedAt`，**保留** existing 的 `source/sourceLabel/pinned`（不清空 agent 速记标记）。
- **置顶** `setQuickNotePinned(id, pinned)`：只改 `pinned/updatedAt`。
- **删除** `deleteQuickNote` / `deleteQuickNotesByRange` / `deleteQuickNotesByIds`：同事务 `bulkDelete` + 逐条 `recordSyncLog("delete")`；`deleteQuickNotesByRange` 只清普通速记，跳过 `pinned === true`，返回 `{deleted}` 仅计实际删除数。
- **JSON 合并导入**：入口在设置 → 数据页（`SettingsDataPage.tsx`，**不在速记页**）→ `importQuickNotes`（`quick-notes/importQuickNotes.ts`）按 `QuickNotesFileSchema` 校验，按 id 合并：不存在则 add，`incoming.updatedAt > existing.updatedAt` 则 update，否则 kept，返回 `{inserted, updated, kept}`。
- **导出**：`exportQuickNotes` 产 JSON（独立备份格式 `timedata.quick-notes.backup`，`quick-notes/schema.ts`，`timeFormat:"utc"`，与主 `timedata.backup` 是两套契约）或 Markdown（同分钟/间隔 ≤5min `MARKDOWN_TIME_GAP_MS` 不重复 `## HH:mm` 时间标题）。速记页按当前 `viewingDate`（「眼前正在看的那天」）导出——注意它**不只在显式跳转时更新**：停止滚动 1.2 秒后的一次扫描会把粘在顶上那条日期写进去，所以它跟随滚动自动漂移；显式写入点是退出搜索 / 回到最新 / 日历跳转 / 搜索结果定位。空日只提示不生成文件，Markdown 成功提示带条数；下载经 `fileDownload.ts`（Blob / 原生 Filesystem+Share）。

写入经 `recordSyncLog` 自动调度上传（`syncScheduler.notifyWrite()`，见 [sync/realtime-and-scheduler](sync/realtime-and-scheduler.md) §2），无需页面显式触发同步。服务端 `quick_notes` 走**通用 LWW 路径**（`sync/domains.ts`），**无自定义 validate/apply/crossValidate**——只有 `QuickNoteSchema` 运行时校验，没有重叠/分类业务校验。

### 1.2 agent 投递（服务端受控写入）

```text
授权 agent → POST /api/quick-notes { text, sourceLabel?, occurredAt? }
        → authMiddleware（Bearer Token，/api/* 全局）
        → routes/quick-notes.ts: createSchema 严格校验（text trim 1..5000、sourceLabel trim 1..64?、occurredAt UTC?）
        → server 生成 id/createdAt/updatedAt，occurredAt ?? now
        → 强制 source="agent"（请求体不含 source，无法伪造）
        → quick_notes/create SyncChange → db.transaction(applyChange) → notifySyncChange
```

这是「服务端受控写入」边界，不是新底层写入路径。**agent 投递端点在 `routes/quick-notes.ts`，不在 `routes/agent.ts`**（后者只有任务状态回写，归 [todo](todo.md)）。agent 不能伪造 `source="user"`，也不能直接编辑 SQLite/IndexedDB/syncLog/备份/导出。

### 1.3 CLI 只读

`timedata notes`（`cli/src/commands/notes.ts`）只构造 GET 路径，无写命令。三模式：`--date YYYY-MM-DD`（缺省 today）、`--from --to`（成对，`to>=from`）、`--recent`（与前两者互斥）；`--limit` 默认 50（1..200）。服务端 `routes/quick-notes.ts` GET → `listQuickNotesForCli`（`quick-note-service.ts`）按时区转 UTC 半开区间查询，返回 `{id, occurredAt(UTC), occurredLocal, text}`，格式化 `cli/src/lib/format.ts`。date/range 模式 `occurred_at ASC`，recent 模式 DESC。不复用 `/api/sync/pull` 设备同步语义。

### 1.4 捕捉中心角色

速记页兼「轻量捕捉入口」：底部 composer 按草稿状态切换动作，空草稿时左侧按钮打开既有搜索态、右侧按钮执行「打点」；有草稿时左侧按钮把文本存为 `tasks` 池任务（调 `addTask`，落点由 `todo.defaultDestination.v1` 决定，见 [todo](todo.md)）、右侧按钮保存速记；编辑中左侧取消、右侧保存。打点建一条普通 `time_entry`（分类来自 `punch.categoryId.v1`，见 [timeline](timeline.md) 的 `punch.ts`）；未配置或分类失效时提示用户到 `设置 → 记录偏好 → 打点分类` 选择。**这些只是现有域的现有写入路径，不新增写入通道，也不让 quick_notes 拥有时间记录/分类契约**。交互按钮统一经 Phosphor `Icon` 包装，不使用 emoji/Unicode 字符按钮；反馈内嵌在底部 composer，不作浮层。composer 的 fixed bottom 只在窄屏且底部 Tab 可见时避让移动底栏，宽屏不预留移动底栏空隙；「存为待办」提交期间用 pending guard 拦截连点，避免同一草稿生成重复任务。

## 2. Schema / 契约（字段级）

### 2.1 `QuickNote`（`entitySchemas.ts:QuickNoteSchema`）

```ts
{
  id: string;            // NonEmptyTrimmed
  text: string;          // NonEmptyTrimmed（schema 只校验 trim 后非空、不自动 trim；客户端 normalizeText 才真 trim）
  occurredAt: string;    // 业务发生时间，严格 UTC ISO（带毫秒+Z）
  createdAt: string;     // 系统创建时间，严格 UTC ISO
  updatedAt: string;     // 编辑/同步时间，严格 UTC ISO
  source?: "user" | "agent";  // 缺省等同 user
  sourceLabel?: string;       // 展示标签，max 64
  pinned?: boolean;           // 缺省/false 等同未置顶
}
```

运行时约束：`source` 只接受 `"user"`/`"agent"`；时间字段严格 UTC ISO（正则 + `toISOString()===value`）；**schema 不强制 `updatedAt >= createdAt`**（避免历史导入/时钟漂移失败）。`text` max 5000 只在 agent POST 入口加，`QuickNoteSchema` 本身无 text 长度上限。

### 2.2 SQL `quick_notes` ↔ JS 映射（`server/src/db/schema.ts`）

| SQL 列 | JS 字段 | 存储 |
|---|---|---|
| id / text / occurred_at / created_at / updated_at | id / text / occurredAt / createdAt / updatedAt | TEXT |
| source / source_label | source / sourceLabel | TEXT，可空 |
| pinned | pinned | INTEGER NOT NULL DEFAULT 0 ↔ 可选 boolean |

索引 `idx_quick_notes_occurred_at` / `idx_quick_notes_updated_at`；`source/source_label/pinned` 无索引。旧库启动幂等 `ALTER TABLE` 补列（`ensureQuickNoteSourceColumns`/`ensureQuickNotePinnedColumn`）。映射 `rowToQuickNote`（`lib/db-rows.ts`，真值才写）/ `quickNoteToRow`（`sync/domains.ts`，`pinned: note.pinned ? 1 : 0`）。Dexie `quickNotes` 索引 `"id, occurredAt, updatedAt"`（`client/src/db/index.ts`）。

### 2.3 同步域登记（`syncDomains.ts`）

`quick_notes` 域：`conflictPolicy:"lww"`、**`countsInStatus:true`**（计入 `/api/sync/status` counts + contentHash 行数）、upsert/deletePriority 40。客户端登记在 `clientDomains.ts`。

客户端启动时的 schema 归一 pass 会按这份登记簿遍历 `quickNotes`：只清理本地 IndexedDB 形状（补默认/剥孤儿，坏行保留并 warn），不写 `syncLog`，不改变 quick_notes 的 LWW 同步语义。

TrackStep 也有 `source: "user" | "agent"` 与 `sourceLabel?`，但那只是复用来源展示口径；轨道步骤不进入 quick notes 独立备份，也不改变 `quick_notes` 的 agent 投递端点。

## 3. 关键不变量 / 坑 / 红线

1. **独立数据域**：`quick_notes` 不引用 `categories`/`time_entries`，不参与分类校验、archived、时间段重叠、时间环、时长统计、分类统计。服务端域无 validate/crossValidate。
2. **三时间戳语义**：`occurredAt`=业务时间（查询/展示/导出/排序），`createdAt`=系统创建时间（不参与业务排序），`updatedAt`=编辑/同步时间（LWW 判断 + 导入合并 + sync 游标）。
3. **排序约定**：时间线/导出按 `occurredAt` 升序（`id` 次级稳定）；搜索结果与置顶列表按 `occurredAt` 倒序；CLI date/range ASC、recent DESC。
4. **`pinned` 参与 content hash**：它改变用户可见分区（置顶区 vs 主列表），故参与本地 content hash 与同步摘要；切换走 `setQuickNotePinned` + `recordSyncLog("update")`。
5. **`source`/`sourceLabel` 是展示元数据，不参与 content hash**；`source="agent"` 由服务端强制（`createSchema` 不含 `source`），**agent 不能伪造 `source="user"`**。
6. **正文存储始终是原始 `text`**：展示层保守 Markdown（`QuickNoteContent`：`looksLikeMarkdown` 命中才用 `react-markdown`+`remark-gfm`+`rehype-sanitize`，否则纯文本）；搜索结果纯文本 `<mark>` 高亮；导出/复制/编辑/同步都用原文。
7. **单条上传状态从 syncLog 推导，不是 QuickNote 字段**：`useUnsyncedQuickNoteIds` 读 `syncLog(tableName="quick_notes", synced=0)`，待上传显示时钟、已同步显示单勾。agent 速记本地无 pending，恒显单勾。
8. **本地 mutation 必须与 syncLog 同事务**；窗口查询/搜索/置顶列表查询只读、不写 syncLog。
9. **`updateQuickNote` 保留 source/sourceLabel/pinned**：编辑只改 text/occurredAt/updatedAt。
10. **速记页 UI 要点**：聊天式连续时间线，最新窗口（`QUICK_NOTE_PAGE_SIZE=50`）向上懒加载；搜索 200ms debounce、空格分词 AND、只读扫描 Dexie，入口在 composer 空草稿左按钮；搜索结果按本地日倒序分组，初始最多渲染 100 条并用「加载更多」继续展开；结果卡片本体不可点（避免误触被拽离搜索流），跳时间线走卡片角上的「定位到时间线」小按钮：非置顶结果保留搜索词、锚定目标所在时间线窗口、滚动到主线卡片并 1.5 秒内侧高亮，置顶结果展开置顶区并跳到日期；点日期分隔条选日期后等窗口就位再把目标日分隔条滚到视口顶（当天无速记则回列表顶，那里就是目标日之后最近的内容）；退出搜索/点「最新」会把 `viewingDate` 与 URL `?date=` 归位到今天；置顶区从 header 钉子展开，主线过滤 pinned；composer 空草稿右按钮打点、有草稿左右分别存待办/记录、编辑中左右分别取消/保存；agent 气泡用动作蓝 soft 形态 + sourceLabel 标题；长按/右键开复制/编辑/置顶/选择/删除菜单（气泡菜单与 header 更多操作/导出菜单均可 Escape 关闭），选择态支持批量复制/导出/删除；多选态置顶区保持可见可勾选（header 有钉子开关，计数在含置顶时显示「含置顶 M」，保证批量删除目标集不含不可见项）；工具栏「全选」只吃已加载的非置顶速记（与「清理跳过置顶」同一保护口径，反选保留置顶勾选），日期分隔条 `position: sticky` 粘顶跟随，停止滚动 1.2 秒后粘住那条淡出隐身（多选态、日历打开期间、「更多操作」/导出菜单打开期间都不扫描：否则「选中这天」点不到、月历失去锚点、菜单项会在用户眼皮底下换目标日）；**主线**每条日期条自身即跳转入口（`DateField` + `hideIcon`），header 不再有常驻跳转框，多选态下日期条旁另有「选中这天」toggle——**搜索态的日期条刻意是纯展示、不可点、里面不含任何 button**（误触会把人从搜索流里拽走，有专门用例锁死）；导出/清理的目标日期跟随「当前粘住那天」（`viewingDate`）而非最后一次显式跳转；更多操作菜单的导出/清理文案带目标日期（今天写「今天」，历史日写 `M月D日`），清理前预取可删条数，非今天显示警示，置顶只说明保留且不删除，空日不弹确认。长文本按渲染高度折叠（`COLLAPSED_MAX_PX=168` + ResizeObserver）。页面壳、气泡、菜单、Markdown chrome 和搜索高亮全部消费 [design-language](design-language.md) 的 `page/surface/border/ink/accent` token；业务时间、日期和数量使用 `td-time` / `td-num`，当前是 Times New Roman / Tinos + tabular nums；交互图标统一经 Phosphor `Icon`，不使用散装字符图标。
11. **sticky 日期条有两条跨文件红线**（不知道就会踩）：① **每天必须各自成一个包裹 div**——`position: sticky` 的约束框是父级内容盒，同一父级下的 sticky 兄弟互不推挤；拍平渲染时滚过去的每条日期条都恒停在偏移位、层层相叠，`findStuckDivider` 会把窗口里最早那天误判成「眼前这天」（导出/清理打错日子），`.stuck` 也打在被压在底下看不见的那条上。分组由纯函数 `quick-notes/dayGroups.ts:groupDisplayItemsByDay` 产出，包裹 div 不得带 `overflow`/`contain`/`transform`/`filter`（任一都会掐断内部 sticky 或改写包含块）。有结构闸用例断言两天的日期条不共享父节点。② **`QuickNotesPage.tsx:STICKY_TOP_PX` 必须等于 JSX 上 `sticky top-2` 的实际像素**（0.5rem = 8px）——它是 `findStuckDivider` 判定区间的上界，三处独立字面量（常量 + 主线/搜索两处 className）改一处不同步既不报错也不 typecheck 失败，由导出常量派生类名的绊线用例守。
12. **composer 可靠性四条语义**：① 未发出的 compose 草稿经 `quick-notes/composerDraft.ts` 落 localStorage `timedata_quicknote_composer_draft`（纯本地、不进同步域与备份），挂载时恢复并给一次「已恢复未发出的草稿」提示；防抖的输入恒为 compose 草稿而非 `draftText`，否则退出编辑那一刻防抖值滞后会把被编辑速记的正文写成草稿。② 编辑态不持久化：编辑中重载退回 compose 草稿，避免用陈旧原文覆盖别的设备已改过的正文。③ 编辑未保存时切去编辑另一条要先确认，脏判定按 `trim()` 比进入编辑时的原文快照。④ 非 `atLatest` 时保存速记必须出「已记录 · 回到最新」toast——新速记落在 timeline 窗口外、气泡不出现，页面零变化会让用户以为没存上而重发；「存为待办」toast 与打点对称提供「撤销」，撤销走 `deleteTask`（`deleteReason` 仍是 `user`，删除样本分析按「创建到删除不足 30 秒」剔除）。

## 4. 模块速查（代码入口 + 路由 + 测试）

### 4.1 客户端

| 入口 | 职责 |
|---|---|
| `pages/QuickNotesPage.tsx` | 速记页主体：时间线、搜索、置顶区、composer（记录/待办/打点）、多选批量、sticky 日期分隔条跳转、底部 Tab 隐藏、actionToast。composer 回车按屏宽分流（`useIsWideScreen`）：宽屏(≥1024px)发送、窄屏（手机）换行交给 textarea 默认行为、靠「记录」按钮发送；宽屏不套移动底栏 bottom offset，窄屏只在底栏可见时避让 |
| `lib/quickNotes.ts` | 域 CRUD + 按日期/范围/窗口/置顶列表查询，全部同事务 syncLog |
| `lib/quickNoteDisplay.ts` | 展示分组 `groupQuickNotesForDisplay`（主线升序、搜索倒序）+ `formatLocalClock` |
| `quick-notes/useQuickNoteTimeline.ts` | 时间线 hook：最新窗口 + 向上懒加载 + 向下补差 + 日期跳转 + 按目标速记锚定窗口 |
| `quick-notes/{searchQuickNotes,searchTerms,highlightMatches,HighlightedText}.*` | 搜索：分词 AND 子串、只读扫描、倒序 + `<mark>` 高亮；页面层负责按天分组、100 条截断与定位 |
| `quick-notes/{NoteBubble,QuickNoteContent,QuickNoteActionMenu,NoteMeta,looksLikeMarkdown}.*` | 气泡 + 保守 Markdown 正文 + 长按菜单 + 时间/上传状态 |
| `quick-notes/{useUnsyncedQuickNoteIds,jumpToLatest,jumpDateLabel,currentDate,dayGroups,clipboard}.*` | 上传状态 hook / 回到最新 / 菜单日期短标签 / 粘住日期条判定 / 按天折成 sticky 包含块分组 / 复制 |
| `quick-notes/{importQuickNotes,exportQuickNotes,schema,fileDownload,deleteQuickNotesRange,deleteQuickNotesByIds}.*` | JSON 合并导入 / JSON·Markdown 导出 / `QuickNotesFileSchema` / 下载 / 范围删 / 多选批量删 |

### 4.2 服务端 / CLI

| 入口 | 职责 |
|---|---|
| `routes/quick-notes.ts` | `GET /`（CLI 只读）+ `POST /`（agent 投递，强制 `source="agent"`，走 `applyChange`+`notifySyncChange`） |
| `lib/quick-note-service.ts` | `listQuickNotesForCli`：date/range/recent 三模式，按时区转 UTC 半开区间 |
| `db/schema.ts` / `lib/db-rows.ts` / `sync/domains.ts` | 建表/索引/ALTER 补列 + `rowToQuickNote` / `quickNoteToRow` + 通用 LWW 注册 |
| `cli/src/commands/notes.ts` / `cli/src/lib/format.ts` | 只读 notes 命令 + 输出格式化 |

### 4.3 测试

**client**：`pages/QuickNotesPage.test.tsx`、`lib/quickNotes.test.ts`、`lib/quickNoteDisplay.test.ts`、`quick-notes/{clipboard,currentDate,dayGroups,deleteQuickNotesByIds,deleteQuickNotesRange,highlightMatches,HighlightedText,jumpDateLabel,jumpToLatest,looksLikeMarkdown,NoteBubble,NoteMeta,QuickNoteActionMenu,QuickNoteContent,searchQuickNotes,searchTerms,useQuickNoteTimeline,useUnsyncedQuickNoteIds}.test.{ts,tsx}`（导入导出测试见子文档）
**server**：`routes/quick-notes.test.ts`、`routes/sync.test.ts`、`sync/*.test.ts`、`db/*.test.ts`
**shared**：`schemas.test.ts`（QuickNoteSchema 专项） ｜ **cli**：`commands/notes.test.ts` ｜ **e2e**：`__tests__/e2e/sync-roundtrip.e2e.test.ts`

## 深水细节

- **`punch.ts` / `punchCategorySetting.ts` 不归本域**：`punch.ts` 写 `time_entries`（归 [timeline](timeline.md)），`punchCategorySetting.ts` 写 `settings`（归 [categories-settings](categories-settings.md)）；速记页只是调用方。
- **`listPinnedQuickNotes` 全表扫描**：pinned 无索引，`.filter(pinned===true)` 后倒序。
- **`occurredAt` 缺省 = `createdAt`**：`addQuickNote` 不传 occurredAt 时用 now。
