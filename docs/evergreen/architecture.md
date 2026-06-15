---
type: evergreen
title: 架构总览
covers:
  - packages/shared/**
  - packages/client/src/db/index.ts
  - packages/client/src/main.tsx
  - packages/client/src/App.tsx
  - packages/client/src/lib/quickNotes.ts
  - packages/client/src/lib/quickNoteDisplay.ts
  - packages/client/src/lib/punch.ts
  - packages/client/src/lib/pendingCategory.ts
  - packages/client/src/pages/QuickNotesPage.tsx
  - packages/client/src/quick-notes/**
  - packages/client/src/pages/TodoPage.tsx
  - packages/client/src/components/RecurrenceEditor.tsx
  - packages/client/src/lib/tasks.ts
  - packages/client/src/lib/tasks/**
  - packages/client/src/pages/StatsPage.tsx
  - packages/client/src/pages/TimeStatsPage.tsx
  - packages/client/src/pages/HealthStatsPage.tsx
  - packages/client/src/pages/stats/**
  - packages/client/src/hooks/useInView.ts
  - packages/client/src/lib/insights/**
  - packages/client/src/lib/statsLayoutSetting.ts
  - packages/client/src/lib/statsModuleTrendSetting.ts
  - packages/client/src/lib/settings/**
  - packages/client/src/lib/syncStream.ts
  - packages/client/src/lib/sleepCategorySetting.ts
  - packages/client/src/pages/settings/SettingsInsightsPage.tsx
  - packages/client/src/pages/settings/SettingsNavPage.tsx
  - packages/client/src/pages/settings/SettingsStatsLayoutPage.tsx
  - packages/client/src/pages/settings/SettingsCategoriesPage.tsx
  - packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx
  - packages/client/src/components/SortableCategoryItem.tsx
  - packages/client/src/hooks/useCategories.ts
  - packages/client/src/lib/categorySort.ts
  - packages/client/src/lib/categoryColors.ts
  - packages/server/src/index.ts
  - packages/server/src/db/schema.ts
  - packages/server/src/lib/quick-note-service.ts
  - packages/server/src/routes/data.ts
  - packages/server/src/routes/export.ts
  - packages/server/src/routes/quick-notes.ts
  - packages/server/src/routes/tasks.ts
  - packages/server/src/routes/sync.ts
  - packages/server/src/sync/**
  - packages/server/src/lib/confirm-token.ts
  - packages/server/src/middleware/rateLimit.ts
  - packages/server/src/middleware/bodyLimit.ts
  - packages/server/src/routes/ingest.ts
  - packages/server/src/garmin/**
  - packages/client/src/pages/stats/health/**
  - packages/client/src/pages/stats/InsightCharts.tsx
  - packages/client/src/lib/healthMetrics/**
  - packages/client/src/lib/healthUtils.ts
  - packages/client/src/pages/settings/SettingsGarminPage.tsx
  - packages/shared/src/healthSchemas.ts
  - packages/cli/src/index.ts
  - packages/mobile/capacitor.config.ts
last-reviewed: 2026-06-15
---

# 架构总览

> 这份文档讲 TimeData 是什么、五个包之间是什么关系、数据怎么流动。
> 函数级实现 **不写**，让代码说话。

## 1. 一句话定位

TimeData 是个人时间记录工具：

- 本地优先：所有读写都先打到本地（浏览器 IndexedDB / SQLite），再异步同步。
- 四类个人数据：时间段记录 `time_entries`、聊天式速记 `quick_notes`、待办任务 `tasks`、健康数据（心率/HRV/睡眠/压力/跑步，来自 Garmin 自动抓取或手动导入）。速记是“时间 + 文本 + 可选来源 / 置顶元数据”，不参与时间段统计；任务是轻量任务池与重复待办，不参与时长统计。
- 一份数据，三个入口：Web/PWA、CLI、Android 壳（Capacitor）；授权 agent 可直连受控 server API 投递 quick note。Garmin 健康数据由服务端定时抓取或手动触发，写入服务端后通过同步下发到客户端。
- 自托管：服务端是单一 Hono + SQLite 进程，可用 Docker 一键部署。

**不做**：多用户、协作、SaaS、复杂权限。

## 2. 五个包的职责与依赖

```
┌──────────────────────────────────────────────────────┐
│  shared       类型与常量（Category / TimeEntry / Task / Sync*）│
└─────────▲────────────▲────────────▲──────────────────┘
          │            │            │
   ┌──────┴───┐  ┌─────┴────┐ ┌─────┴────┐
   │ client   │  │ server   │ │ cli      │
   │ React+   │  │ Hono+    │ │ Node CLI │
   │ Dexie    │  │ SQLite   │ │          │
   └────┬─────┘  └─────▲────┘ └─────┬────┘
        │              │            │
        │ HTTP /api    │ HTTP /api  │ HTTP /api
        └──────────────┴────────────┘
        │
   ┌────┴───────┐
   │ mobile     │  Capacitor Android 壳
   │ (WebView)  │  webDir 指向 client/dist
   └────────────┘
```

依赖方向单向：`client` / `server` / `cli` 都依赖 `shared`，相互之间**不依赖**——它们靠 HTTP API + 共享类型契约协作。`mobile` 不写业务代码，只负责把 `client` 的 mobile 构建产物装进 Android WebView，并声明需要注册进原生工程的 Capacitor 插件。

## 3. 典型数据流

### 3.1 用户在 Web 端记录一条时间

```
用户操作 → React 组件
        → Dexie.put(timeEntries)
        → 写一条 syncLog（synced=0）
                    │
              （后续触发同步）
                    ▼
        → POST /api/sync/push
        → server 校验 + 备份 + apply
        → 返回 outcomes
        → 更新本地 syncLog.synced=1
```

关键点：**写本地永远不会失败**（除非 IndexedDB 损坏），网络是异步的。这是"本地优先"的核心。客户端本地业务表写入与对应 `syncLog` 追写必须处在同一个 Dexie transaction 中，避免业务表成功但待同步日志缺失。

### 3.2 用户在 Web 端发一条速记

```
用户输入文本 → React QuickNotesPage
        → Dexie.put(quickNotes)
        → 写一条 syncLog（synced=0）
                    │
              （后续触发同步）
                    ▼
        → POST /api/sync/push
        → server 校验 QuickNote schema + 写 SQLite quick_notes
        → 返回 outcomes
        → 更新本地 syncLog.synced=1
```

关键点：速记是独立数据域，以 `occurredAt + text` 为核心，可带 `source` / `sourceLabel` 展示来源和 `pinned` 置顶状态；它不引用分类，不生成时间段，不进入重叠校验、时间环或分类统计。客户端导出、导入、范围删除和多选批量删除都只操作 `quickNotes`，并在写入本地业务表的同一 Dexie transaction 中追写 `syncLog`。

### 3.3 用户在 Web 端管理待办

```
用户操作 → TodoPage / RecurrenceEditor
        → Dexie.put(tasks)
        → 写一条 syncLog(tableName="tasks", synced=0)
                    │
              （后续触发同步）
                    ▼
        → POST /api/sync/push
        → server 走 tasks 通用 LWW 域 + sync_seq
        → 其他设备按 seq 拉取
```

关键点：`tasks` 是轻量待办域，不引用分类或时间记录。普通任务池条目用 `done` 表示完成；重复任务用 `recurrence` + `lastDoneAt` + `completedCount` 计算当前是否到期和是否已耗尽。无终止条件的重复任务勾选后继续循环；带 `count` 或 `until` 的重复任务在做满/无后续发生后置为 `done=true` 并沉入完成区。服务端只暴露只读 `GET /api/tasks` 供受控客户端查询；Web 端写入仍先落 Dexie，再经同步管线送到服务器。

### 3.4 用户在多设备间同步（账本模型）

服务器维护只增不减的变更账本（`sync_seq`），每台设备只持有读数 `timedata_last_synced_seq`。`regularSync()`（`packages/client/src/sync/engine.ts`）：

1. **预检**：读本地未同步 `syncLog` 计数 + `/api/sync/status` 取云端 `latestSeq`。
2. **No-op**：本地无未同步变更且读数不落后于云端账本，直接返回"无需同步"，不 push、不 pull、不创建备份。
3. **Pull-only 补差**：本地无未同步变更但云端账本更新，先创建本地自动备份，再按 `sinceSeq` 补差。
4. **真实同步**：本地有未同步变更，先创建本地自动备份，再 push（合并、压缩、带分类依赖）→ 按 `sinceSeq` 补差。
5. 冲突交给用户决定 `keep_local` / `use_remote`（仅 manual 域；lww 域后写赢自动解决）。
6. 每次同步把摘要写到服务器 `sync_logs` 表（best-effort，失败不影响同步）。

`updated_at` 由服务器在记账时分配，设备时钟漂移不影响同步正确性。数据域（同步认识哪些表、各域校验与冲突策略）由域登记簿驱动，见 [`sync.md`](./sync.md) 第 0 节与 [`ADR 0012`](../adr/0012-sync-ledger-and-domain-registry.md)。

同步记录和备份记录是两套空间：`syncLog` 是客户端待同步队列，服务端 `sync_logs` 是运维审计；自动备份记录只在设置页的数据设置里展示，用于恢复本地数据。

### 3.5 AI/脚本通过 CLI 写一条记录

```
timedata log --start 09:00 --end 10:00 --category 投资/读书
        → CLI 校验参数（日期、时间段格式）
        → POST /api/entries
        → server 路由调 createEntryFromCliInput()
        → 服务端权威校验（时间段、分类存在、不重叠）
        → 写 SQLite
        → 返回 ok/错误
```

**CLI 不直接碰 SQLite**——它只是 server API 的客户端。这条规则是红线，详见 [`adr/0001-cli-as-only-write-path.md`](../adr/0001-cli-as-only-write-path.md) 与修订 [`adr/0011-server-api-as-write-boundary.md`](../adr/0011-server-api-as-write-boundary.md)。

### 3.6 AI/脚本通过 CLI 读速记

```
timedata notes --date 2026-06-02
        → CLI 校验日期 / 范围 / limit 参数
        → GET /api/quick-notes?date=2026-06-02&format=cli
        → server 按应用时区转 UTC 边界，查询 SQLite quick_notes
        → 返回 UTC occurredAt + 本地 occurredLocal + text
```

关键点：这是 CLI 的只读入口，不创建、修改、删除速记，也不复用 `/api/sync/pull` 的设备同步语义。授权 agent 投递速记走服务端受控写接口 `POST /api/quick-notes`，不要求 CLI 增加写命令。

### 3.7 授权 agent 通过 server API 投递速记

```
云端 agent → POST /api/quick-notes { text, sourceLabel?, occurredAt? }
        → authMiddleware 校验 Bearer Token
        → server 校验 body，生成 id / createdAt / updatedAt
        → 强制 source="agent"
        → 构造 quick_notes/create SyncChange
        → applyChange() 写 SQLite quick_notes + sync_seq
        → notifySyncChange(getLatestSeq())
        → 前台客户端经 SSE bump 触发普通同步拉取
```

关键点：这仍属于“服务端受控 API”写入边界，不是第三条底层写入路径。agent 不能提交 `source` 伪造成 user，也不能直接编辑 SQLite、IndexedDB、syncLog、Backup 或导出文件。

### 3.7 Garmin 健康数据抓取

```
Garmin 定时任务 / 手动触发
        → garminService.ts 启动 Python 子进程 garminFetch.py
        → garminFetch.py 用 garminconnect 库登录 Garmin Connect
        → 逐日调 5 个 API（heart_rate / hrv / sleep / stress / activities）
        → 构建 camelCase 记录，输出 JSON 到 stdout
        → garminService.ts 解析 JSON
        → 按域逐条 safeParse + applyChange() 写 SQLite
        → notifySyncChange() 通知客户端 SSE
        → 客户端 pull 获取新健康数据
```

关键点：Garmin 数据走的是与 agent 速记相同的"服务端受控写入"路径（`applyChange()` + `sync_seq`），不是新的底层写入通道。Python 脚本只负责数据抓取和格式化，不直接碰 SQLite。自动任务不再用 `lastFetchDate` 判定窗口，而是读取 `health_heart_rate` / `health_hrv` / `health_sleep` / `health_stress` 的最新日期，从最早缺口补到昨天；完全无健康数据时按 `initialBackfillDays`（默认 7，配置范围 1..30）首次回填。`runs` 不参与缺口判断，手动抓取可显式指定最多 90 天日期范围，或强制重抓最近 N 天到昨天。每次抓取有 `runId`、结构化 `status` / `errors`，输出 `[garmin]` 日志，并 best-effort 写 `sync_logs(device="garmin", action="garmin_fetch")` 便于排查。凭证在 `server_config` 表中 AES-256-GCM 加密存储，密钥派生自 `AUTH_TOKEN`。独立模块位于 `packages/server/src/garmin/`，详见其 `README.md`。

### 3.8 健康数据批量导入（ingest API）

```
POST /api/health/ingest { domain: "health_heart_rate", records: [...] }
        → authMiddleware 校验 Bearer Token
        → zod schema 校验每条记录
        → 按域 applyChange() 写 SQLite
        → notifySyncChange()
```

`/api/health/ingest` 是健康数据的通用入口，Garmin 服务内部直接调 `applyChange()` 而非经此 HTTP 端点，但此端点保留用于 CLI 脚本迁移历史数据。

## 4. 启动顺序

### 4.1 服务端（`packages/server/src/index.ts`）

1. 创建 Hono app
2. 装 `secureHeaders` 中间件（全局 `*`）：注入 `Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`、`Strict-Transport-Security` 等安全响应头；CSP 故意留空，避免破坏生产 SPA 的内联样式
3. 装 CORS 中间件（`/api/*`，来源由 `ALLOWED_ORIGINS` 白名单控制，默认空数组 fail-closed）
4. 装 `bodyLimit` 中间件（`/api/*`，上限由 `MAX_BODY_BYTES` 控制，默认 5 MB；`Content-Length` 超限会快速拒绝，无/未知长度 body 会先读取 cloned request 计数，超出返回 HTTP 413 且不消费原始 body）
5. 暴露不需要鉴权的两个路由：`/api/health`、`/api/version`
6. 装 auth 中间件（之后所有受保护的 `/api/*` 默认需要 Bearer Token；未设 `AUTH_TOKEN` 时 fail-closed，仅 `ALLOW_UNAUTHENTICATED_DEV=1` 显式开发旁路会放行）
7. 装 `rateLimit` 中间件（`/api/sync/*`，60s 窗口，上限 `SYNC_RATE_MAX` 次，默认 60；`/api/admin/*`，同窗口，上限 `ADMIN_RATE_MAX` 次，默认 120；超出返回 HTTP 429）
8. 注册业务路由：`categories`/`entries`/`quick-notes`/`tasks`/`sync`/`export`/`update`/`data`/`admin`（含 `sync-logs`）/`health`（ingest）/`admin/garmin`（配置/抓取/状态）
9. 静态文件兜底：`public/` 服务客户端打包产物 + index.html SPA fallback
10. 调 `initializeDatabase()`：建表（含 `server_config` 和健康数据表）、首次启动播种默认分类
11. 启动时清理一次旧 server backup
12. 加载 Garmin 配置，若已启用定时抓取则调 `updateSchedule()` 注册 setTimeout 定时器；到点后按 SQLite 健康表缺口智能补到昨天，并在抓取成功后把 `lastFetchDate` 更新为本次 `endDate` 供状态展示
13. `SERVER_REPLICAS>1` 时提示 force-push token 和 Garmin 定时器仍是单实例内存存储
14. 监听 `PORT`（默认 3000）

### 4.2 Web 客户端（`packages/client/src/main.tsx`）

1. `seedDefaultCategories()`：本地分类表为空时插入默认两级分类
2. 渲染前确认 DOM 中存在 `#root` 挂载点；缺失时显式抛错，避免挂载点问题被非空断言掩盖。
3. `<AppUpdateProvider>`：包住 PWA 自更新提示
4. `ErrorBoundary` 包裹 `BrowserRouter` / `SyncProvider` / `BottomNavProvider` / `AppShell`，顶层渲染错误会落到统一错误页，避免整屏空白。
5. `SyncProvider` 包裹在 React Router 内、`AppShell` 外，为时间轴、待办、记录编辑页、设置首页和数据设置页提供同一个客户端同步状态与触发入口；云同步开启、API 地址已配置且页面处于前台时，它还会维护一条 `/api/sync/stream` SSE 连接，用连接态驱动设置页服务器灯，并在远端 `latestSeq` 变大时防抖触发普通同步。`BottomNavProvider` 只承载底部导航显隐状态，不参与数据同步：时间轴 / 时间统计 / 健康统计 / 待办 / 设置首页经 `AppShell` 的 `<main>` 滚动容器统一接 `useHideBottomNavOnScroll`（向下滑动隐藏、上滑或接近顶部恢复，带滞回阈值，纯判定逻辑见 `lib/navScroll.ts`），路由切换即重置为显示；速记页因自带内层滚动容器而单独处理，并在输入聚焦或软键盘打开时一并隐藏底部 Tab、让底部 composer 对齐底部导航。底部 Tab 的可见主入口由 `nav.visibleTabs.v1` 设置持久化，旧 `/stats` 设置值读取时映射到 `/stats/time`，`/settings` 固定保留。
6. React Router 装主路由：`/`、`/quick-notes`、`/todo`、`/stats/time`、`/stats/health`、`/stats`（重定向到 `/stats/time`）、`/settings`（含子页 `/settings/server`、`/settings/data`、`/settings/nav`、`/settings/insights`、`/settings/stats-layout`、`/settings/admin-insights`、`/settings/garmin`、分类设置相关路由）、`/entries/:id/edit`。设置首页汇总服务器连接灯与同步摘要，并按记录数据、服务端更新等入口分组；设置子页统一复用 `SettingsDetailPage` 的返回头与内容容器，`SettingsNavPage` 负责底部导航显隐，`SettingsInsightsPage` 只负责睡眠分类口径设置，`SettingsStatsLayoutPage` 只负责时间统计模块显隐、上移/下移和重置，`SettingsGarminPage` 负责 Garmin 账号配置、定时抓取和手动触发。
7. `<AppShell>` 统一监听 PWA/Android 从后台恢复到前台的事件，并把刷新信号传给时间轴和新增记录页，让这些页面重新读取当前时间。
8. `useMidnightTick`（`packages/client/src/hooks/useMidnightTick.ts`）在 `TimelinePage` 内独立调度本地午夜定时器，跨午夜后强制重新计算 `now`，避免长时间停留在前一天显示状态。
9. 重复性 prompt 走 `useConfirm` / `ConfirmDialog`，不直接调 `window.confirm`/`alert`，便于本地化和 Android WebView 体验统一。

### 4.3 CLI（`packages/cli/src/index.ts`）

每次调用都是冷启动：

1. 解析命令和 flags
2. `help` / `--help` 直接输出 JSON 帮助，不读取 server 配置
3. 未知命令在读取配置前返回 `UNKNOWN_COMMAND`
4. `doctor` 读取配置后执行只读诊断（配置、server 连通性、认证）
5. 数据命令解析 config（优先级：flag > 环境变量 > 配置文件）后路由到 `categories` / `list` / `log` / `notes`
6. 输出 JSON（带 `ok: true/false`），按结果设置退出码

命令清单由 `packages/cli/src/commands/help.ts` 的 `commandRegistry` 统一维护：`runHelp()` 直接渲染它，`packages/cli/src/index.ts` 用 `commandRegistry.find(...).handler` 判断未知命令并分发，并从中派生 `dispatchCommandNames`（去掉只读特例 `help` / `version`）。注册表覆盖测试在 `packages/cli/src/index.test.ts` 断言 `dispatchCommandNames` 等于注册表里所有需要运行时分发的命令，防止以后新增命令时漏接 dispatch。

### 4.4 Android 壳（`packages/mobile`）

1. 通过 `pnpm --filter @timedata/client build:mobile` 产出 `client/dist`（mobile 模式：相对路径 + 关闭 service worker）
2. `cap sync android` 把 `client/dist` 拷进 Android 工程的 `assets/public/`
3. Gradle 打 APK，WebView 加载本地静态文件
4. Android 系统返回键/边缘返回由 `packages/mobile` 注册的 `@capacitor/app` 原生插件转成 client 侧事件，再由 client 监听器桥接到 React Router 页面层级
5. Capacitor 配置要求 HTTPS scheme、禁用 cleartext 和 mixed content；开发或内网 HTTP 调试需要先明确改配置再同步 Android 工程
6. 同步靠用户在 App 内填 API 地址 + Token

## 5. 关键约定

1. **跨端契约只在 `packages/shared`**：`packages/shared/src/types.ts` 导出 `Category`、`TimeEntry`、`QuickNote`、`Task`、`Recurrence`、`Setting`、`SyncChange`、`SyncPushOutcome`、`SyncPushReasonCode` 等静态类型，`packages/shared/src/schemas.ts` 导出对应运行时 schema，并在 server 路由和跨端同步边界收紧 UTC ISO 时间（严格 `YYYY-MM-DDTHH:mm:ss.sssZ`）、`#RRGGBB` 色值、整数排序、非空字符串、`QuickNote.text` 非空、`QuickNote.source` 只能是 `"user" | "agent"`、`QuickNote.sourceLabel` 最长 64 字符、`QuickNote.pinned` 只能是 boolean、`Task.title` 非空、重复规则字段、`Setting.value` 字符串值、`SyncLogEntry.synced` 的 `0 | 1` 数字状态、pull / force-push 请求形状等输入。同步 cursor 和计数字段（`baseSeq`、`sinceSeq`、`latestSeq`、`categoryCount`、`entryCount`、`quickNoteCount`）必须是有限非负整数或按契约允许 `null` / 缺省；后台洞察响应里的分页、计数、备份大小和备份 ID / 文件名也由 shared runtime schema 收紧。改这些 = 改公开 API。同步契约还承载本地优先诊断字段（如 `overriddenRecordIds`、`backupId`、`importedQuickNotes`、`importedTasks`），后台洞察契约承载最近同步问题和受保护备份元数据，三端展示/处理必须一起检查。
2. **时间用 ISO 字符串**：服务端 SQLite 的 `start_time` / `end_time` / `*_at` 都是字符串字段，比较直接靠字典序。Dexie 同样存字符串。
3. **写入边界是服务端受控 API**：用户在 Web 端通过组件 → Dexie；脚本/AI/agent 经 server API → SQLite，CLI 是 server API 的受控客户端之一，授权 agent 也可直连受控写接口。服务器不再暴露 JSONL/CSV 导入写库接口；`GET /api/export` 只读，CSV 导出会对公式样式单元格（含前导空白后出现 `= + - @`）加单引号防护；`POST /api/data/reset` 是人工维护入口，必须先调用 `/api/data/reset/prepare` 拿短时确认 token 并提交确认短语。任何 AI/脚本/agent 都不能直接编辑 IndexedDB、SQLite、syncLog、Backup 或导出文件。
4. **服务端是权威**：时间段重叠、分类存在、archived、时间格式合法等的最终判定都在 `packages/server/src/sync/validation.ts` 和 `packages/server/src/lib/entry-service.ts`。同步校验里需要按应用时区比较当前时间的逻辑统一走 `packages/server/src/lib/timezone.ts`；client / CLI 的同名校验只是为了体验，不能让 server 跳过。
5. **SQL 字段名 vs JS 字段名**：服务端 SQLite 用 `snake_case`（`parent_id`、`start_time`），跨边界（路由 / 同步 / 后台洞察）时手工映射成 JS 的 `camelCase`（`parentId`、`startTime`）。这是**手工映射**，没有 ORM。
6. **后台洞察只读**：`/api/admin/*` 的概览、最近记录、分类汇总、同步诊断、备份元数据、健康检查和基础分析保持只读；受控维护端点（如 `/api/admin/sync-logs`）必须有独立校验和显式确认保护。admin 路由复用现有 Bearer Token 鉴权，不提供任意 SQL。
   - 代码入口：`packages/server/src/routes/admin.ts`、`packages/server/src/index.ts`、`packages/client/src/lib/adminApi.ts`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx`、`packages/client/src/pages/SettingsPage.tsx`、`packages/client/src/App.tsx`
   - 相关测试：`packages/server/src/routes/admin.test.ts`、`packages/client/src/lib/adminApi.test.ts`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.test.tsx`、`packages/client/src/pages/SettingsPage.test.tsx`
7. **分类管理页负责分类排序、重命名、新增、归档、直接删除和颜色调整**：`Category.sortOrder` 是同一个 `parentId` 作用域内的展示顺序。Web 分类管理页用 dnd-kit 做拖拽手柄，一级分类只能和一级分类重排，子分类只能在同一个父分类下重排；松手后批量更新 Dexie 的 `categories.sortOrder` / `updatedAt`，并为每个变化项写 `syncLog`，后续仍走现有同步推送。新增分类和重命名都会 trim 名称并拒绝空名；同层级未归档分类重名会被拒绝。分类重命名只改 `Category.name` / `updatedAt`，不改 `Category.id`，并同步更新本地 `autoBackups` 里同 ID 分类的可见字段。归档保留分类行，更新 `isArchived` / `updatedAt`，并写 `syncLog` update 后走 `categories/update`；归档 mutation 在 `useCategories.ts` 中以 `archiveCategory()` 单独导出，同时仍由 `useCategories()` 暴露给页面。直接删除会删除目标分类、后代分类和关联记录，并走 `categories/delete` / `time_entries/delete` 同步。颜色只在一级分类上调整，子分类跟随父分类；一键配色按当前未归档一级分类顺序循环应用预设色板。
   - 代码入口：`packages/client/src/pages/settings/SettingsCategoriesPage.tsx`、`packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx`、`packages/client/src/components/SortableCategoryItem.tsx`、`packages/client/src/hooks/useCategories.ts`、`packages/client/src/lib/categorySort.ts`、`packages/client/src/lib/categoryColors.ts`
   - 相关测试：`packages/client/src/lib/categorySort.test.ts`、`packages/client/src/lib/categoryColors.test.ts`、`packages/client/src/hooks/useCategories.test.ts`、`packages/client/src/pages/settings/SettingsCategoriesPage.test.tsx`、`packages/client/src/pages/settings/SettingsCategoryDetailPage.test.tsx`
8. **Quick Notes 是独立速记域**：`QuickNote.occurredAt` 是业务发生时间，`createdAt` 是系统创建时间，`updatedAt` 是编辑/同步时间；`source` / `sourceLabel` 是展示元数据，`source="agent"` 表示授权 agent 投递；`pinned` 是跨端同步的置顶状态，缺省等同未置顶。`quick_notes` 不引用 `categories` 或 `time_entries`，不参与分类校验、归档校验、时间段重叠、时间环、时长统计或分类统计。Web 速记页按聊天式连续时间线展示：初始加载最新窗口，向上懒加载更早内容，日期控件只跳到有界窗口；滚动时浮层日期胶囊保留当前本地日期并可直接打开日期选择；顶部搜索态用 200ms debounce 后的空格分词 AND 查询直接只读扫描 Dexie `quickNotes`，以扁平结果列表替换时间线，并用 `<mark>` 高亮命中词；置顶速记从顶部 header 的钉子按钮展开，始终不藏在主滚动列表深处，也不在主时间线重复。普通速记气泡是紧凑灰底，agent 速记气泡用深蓝底、弱蓝边框和来源标签区分，点击/焦点态仍只沿用同一个绿色外层状态。气泡单点无编辑效果，长按/右键打开复制、编辑、置顶/取消置顶、选择、删除菜单，编辑回填到底部输入框；选择态支持批量复制、Markdown/JSON 导出和批量删除。速记页统一移动与宽屏为单列气泡，把本地时钟与单条上传状态放进气泡右下角；上传状态从本地 `syncLog(tableName="quick_notes", synced=0)` 推导，待上传显示时钟，已上传或服务端下发的 agent 速记显示单勾。页面在向下滚动、底部输入聚焦或检测到软键盘打开时临时隐藏底部 Tab；长文本气泡按渲染后高度折叠，展开/收起按钮不会进入长按菜单路径。速记正文保存原始文本，展示层仅在命中保守结构语法时用 `react-markdown` + `remark-gfm` + `rehype-sanitize` 安全渲染 Markdown，未命中时保持纯文本；搜索结果始终按纯文本高亮渲染，不参与 Markdown 渲染。它可以独立 JSON/Markdown 导出、独立 JSON 合并导入、按日期范围或按多选 ID 删除；这些本地 mutation 都要和 `syncLog(tableName="quick_notes")` 同事务。AI/脚本可通过只读 `timedata notes` 查询服务端速记；授权 agent 可通过 `POST /api/quick-notes` 投递 `source="agent"` 的速记，服务端复用 `applyChange()` + `notifySyncChange()` 下发到前台客户端。速记页同时承担"捕捉中心"角色：composer 左「待办」把输入文本存为 `tasks` 池任务，header 右上角「打点」按规则 2（起点=今天最后一条记录 end，否则今天 0 点）建一条分类=「待定」（固定 id `cat-pending`，缺失/归档时由 `ensurePendingCategory` 按需补种）的普通 `time_entry`，"在待定分类里 = 待补"，补录走首页时间轴的现有 EntryForm；打点/存待办仅是现有域的现有写入路径，不新增写入通道。
   - 代码入口：`packages/client/src/pages/QuickNotesPage.tsx`、`packages/client/src/lib/quickNotes.ts`、`packages/client/src/lib/quickNoteDisplay.ts`、`packages/client/src/lib/punch.ts`、`packages/client/src/lib/pendingCategory.ts`、`packages/client/src/quick-notes/`、`packages/server/src/db/schema.ts`、`packages/server/src/lib/quick-note-service.ts`、`packages/server/src/routes/quick-notes.ts`、`packages/server/src/routes/sync.ts`、`packages/server/src/sync/validation.ts`、`packages/server/src/sync/resolver.ts`
   - 相关测试：`packages/client/src/pages/QuickNotesPage.test.tsx`、`packages/client/src/lib/quickNotes.test.ts`、`packages/client/src/quick-notes/*.test.ts`、`packages/server/src/routes/quick-notes.test.ts`、`packages/server/src/routes/sync.test.ts`、`packages/server/src/sync/validation.test.ts`、`packages/server/src/sync/resolver.test.ts`、`packages/client/src/__tests__/e2e/sync-roundtrip.e2e.test.ts`
9. **Tasks 是轻量待办域**：`Task` 存在于 Dexie `tasks` 与 SQLite `tasks`，通过 `syncLog(tableName="tasks")` 和 `sync_seq` 同步，冲突策略是 LWW，不进入手动冲突 UI，也不计入 `/api/sync/status` 的业务计数。`TodoPage` 把任务拆成重复任务和任务池；`RecurrenceEditor` 维护 `daily` / `weekly` / `monthly` 规则、间隔、可选本地时间、`due` / `completion` 基准，以及结束条件 `never` / `count` / `until`。任务池勾选翻转 `done`；重复任务勾选更新 `lastDoneAt` 并递增 `completedCount`，当前是否待做由 `isDueNow()` 按本地日序号计算。`count` 满或 `until` 完成最后一次后任务沉入完成区；`until` 已过但仍有逾期未完成发生时留在今天。点任务行或重复任务行从底部弹出 `TaskDetailSheet` 详情抽屉，自动保存式编辑标题、子任务和重复规则；排期日（今天、收纳、日期）仍走列表行侧滑快捷操作，不进抽屉。server 只提供只读 `GET /api/tasks?kind=pool|recurring&done=0|1` 查询入口；写入仍必须来自 Web 本地优先同步或未来明确设计的受控 API。
   - 代码入口：`packages/client/src/pages/TodoPage.tsx`、`packages/client/src/pages/todo/TaskDetailSheet.tsx`、`packages/client/src/components/RecurrenceEditor.tsx`、`packages/client/src/lib/tasks.ts`、`packages/client/src/lib/tasks/recurrence.ts`、`packages/server/src/routes/tasks.ts`、`packages/server/src/sync/domains.ts`
   - 相关测试：`packages/client/src/pages/TodoPage.test.tsx`、`packages/client/src/pages/todo/TaskDetailSheet.test.tsx`、`packages/client/src/components/RecurrenceEditor.test.tsx`、`packages/client/src/lib/tasks.test.ts`、`packages/client/src/lib/tasks/recurrence.test.ts`、`packages/client/src/lib/tasks/placement.test.ts`、`packages/server/src/routes/tasks.test.ts`、`packages/server/src/routes/sync.test.ts`

## 6. 模块速查（结合代码路径）

| 模块 | 关键入口 | 进一步阅读 |
|---|---|---|
| 数据模型 | `packages/shared/src/types.ts`、`packages/shared/src/schemas.ts` | [`data-model.md`](./data-model.md) |
| Quick Notes | `packages/client/src/pages/QuickNotesPage.tsx`、`packages/client/src/lib/quickNotes.ts`、`packages/client/src/quick-notes/**`、`packages/server/src/db/schema.ts`、`packages/server/src/lib/quick-note-service.ts`、`packages/server/src/routes/quick-notes.ts` | [`data-model.md`](./data-model.md)、[`sync.md`](./sync.md)、[`backup.md`](./backup.md) |
| 待办任务 | `packages/client/src/pages/TodoPage.tsx`、`packages/client/src/pages/todo/TaskDetailSheet.tsx`、`packages/client/src/components/RecurrenceEditor.tsx`、`packages/client/src/lib/tasks.ts`、`packages/client/src/lib/tasks/**`、`packages/server/src/routes/tasks.ts` | [`data-model.md`](./data-model.md)、[`sync.md`](./sync.md)、[`backup.md`](./backup.md) |
| 同步推/拉 | `packages/server/src/sync/`、`packages/client/src/sync/`、`packages/client/src/lib/settings/` | [`sync.md`](./sync.md) |
| Backup | `packages/client/src/backup/` | [`backup.md`](./backup.md) |
| 客户端统计洞察 | `packages/client/src/pages/StatsPage.tsx`、`packages/client/src/pages/TimeStatsPage.tsx`、`packages/client/src/pages/stats/modules/`、`packages/client/src/pages/stats/InsightCharts.tsx`、`packages/client/src/lib/insights/`、`packages/client/src/lib/statsLayoutSetting.ts`、`packages/client/src/lib/statsModuleTrendSetting.ts`、`packages/client/src/pages/settings/SettingsInsightsPage.tsx`、`packages/client/src/pages/settings/SettingsStatsLayoutPage.tsx` | `StatsPage.tsx` 只负责旧 `/stats` 重定向到 `/stats/time`，`TimeStatsPage.tsx` 承载周期/日期/总时长上下文和共享取数，内容区按 `STATS_MODULES` 注册表渲染可见模块；`stats.layout.v1` 存模块顺序与隐藏列表，读取时按注册表 sanitize，并让隐藏模块不挂载、不计算，baseline 数据只在可见模块声明需要时取；趋势模块用 `stats.module.trend.v1` 记住最后使用的窗口和图表类型，时间投入的堆叠面积图按单日本地日上限固定 0 到 24h Y 轴；`cache.ts` 负责模块级指纹缓存与重计算记忆化，`dailyRollup.ts` 负责本地日桶预聚合，`routine.ts` 负责作息样本和通常睡眠窗口，`overview.ts` 负责总览、父子占比和覆盖率；当前周/月只统计到今天，异常检测在当前周期产出、用近 90 天基线定阈值 |
| 健康仪表盘 | `packages/client/src/pages/HealthStatsPage.tsx`、`packages/client/src/pages/stats/health/`、`packages/client/src/lib/healthMetrics/`、`packages/client/src/lib/healthCharts.ts`、`packages/client/src/lib/settings/healthRangeSetting.ts`、`packages/shared/src/healthSchemas.ts`、`packages/shared/src/chartSchemas.ts` | `/stats/health` 独立读取健康 Dexie 表与 `healthCharts` 块配置，按页面范围渲染摘要块、可配置 `metricChart`、跑步配速块和最近 5 条跑步；右上角搭建器可新增/编辑 `metricChart`，多指标时柱状禁用。`healthMetrics/` 提供指标注册表、series 引擎、归一化、睡眠时长、配速、rolling pace 和摘要计算；`health_charts` 是同步域，默认注入摘要/健康趋势/跑步配速三块，用户可删除或编辑 metricChart。 |
| Garmin 数据服务 | `packages/server/src/garmin/`、`packages/client/src/pages/settings/SettingsGarminPage.tsx` | Python 子进程抓取 → TS 服务写库 → Admin API → 客户端设置页；凭证 AES-256-GCM 加密存 `server_config` 表；详见 `packages/server/src/garmin/README.md` |
| CLI 命令 | `packages/cli/src/commands/` | [`cli.md`](./cli.md) |
| 部署 / 自更新 | `docker-compose.yml`、`packages/server/src/lib/update.ts`、`packages/server/Dockerfile` | [`deployment.md`](./deployment.md)；Dockerfile 运行时阶段包含 Python 3 + garminconnect + garth |
| 审查 / 排期边界 | `AGENT.md` | [`AGENT.md#项目定位边界`](../../AGENT.md#项目定位边界) |

## 7. 不在这份文档里的事

- 函数实现（让代码说话）
- 本地开发过程计划（看本地-only 的 `docs_local/plans/`）
- 本地设计规格（看本地-only 的 `docs_local/specs/`）
