---
type: evergreen
title: 架构总览
covers:
  - packages/shared/**
  - packages/client/src/main.tsx
  - packages/client/src/App.tsx
  - packages/client/src/pages/settings/SettingsCategoriesPage.tsx
  - packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx
  - packages/client/src/components/SortableCategoryItem.tsx
  - packages/client/src/hooks/useCategories.ts
  - packages/client/src/lib/categorySort.ts
  - packages/client/src/lib/categoryColors.ts
  - packages/server/src/index.ts
  - packages/server/src/routes/data.ts
  - packages/server/src/routes/export.ts
  - packages/server/src/lib/confirm-token.ts
  - packages/server/src/middleware/rateLimit.ts
  - packages/server/src/middleware/bodyLimit.ts
  - packages/cli/src/index.ts
  - packages/mobile/capacitor.config.ts
last-reviewed: 2026-05-18
---

# 架构总览

> 这份文档讲 TimeData 是什么、五个包之间是什么关系、数据怎么流动。
> 函数级实现 **不写**，让代码说话。

## 1. 一句话定位

TimeData 是个人时间记录工具：

- 本地优先：所有读写都先打到本地（浏览器 IndexedDB / SQLite），再异步同步。
- 一份数据，三个入口：Web/PWA、CLI、Android 壳（Capacitor）。
- 自托管：服务端是单一 Hono + SQLite 进程，可用 Docker 一键部署。

**不做**：多用户、协作、SaaS、复杂权限。

## 2. 五个包的职责与依赖

```
┌──────────────────────────────────────────────────────┐
│  shared       类型与常量（Category / TimeEntry / Sync*）│
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

## 3. 三种典型数据流

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

### 3.2 用户在多设备间同步

`regularSync()`（`packages/client/src/sync/engine.ts`）：

1. **预检**：先读取本地 `categories` / `timeEntries` / 未同步 `syncLog` 数量，再通过 `/api/sync/status` 读取云端 meta 摘要。
2. **No-op**：如果本地无未同步变更，且本地/云端 `categoryCount`、`entryCount`、`lastUpdatedAt` 一致，直接返回“无需同步”，不 push、不 pull、不创建本地自动备份，也不触发服务端 `sync_push` 备份。
3. **Pull-only repair**：如果本地无未同步变更但 meta 不一致，先创建本地自动备份，再拉最近 7 天服务器变更 → 本地。
4. **真实同步**：如果本地有未同步变更，先创建本地自动备份，再 push 未同步的本地变更 → 服务器（合并、压缩、带分类依赖），然后拉最近 7 天服务器变更。
5. 冲突交给用户决定 `keep_local` / `use_remote`。
6. 每次同步把摘要写到服务器 `sync_logs` 表（best-effort，失败不影响同步）。`localStorage.timedata_legacy_snapshot_sync="1"` 可临时回退到旧的全量快照比较路径。

同步记录和备份记录是两套空间：`syncLog` 是客户端待同步队列，服务端 `sync_logs` 是运维审计；自动备份记录只在设置页的数据设置里展示，用于恢复本地数据。

### 3.3 AI/脚本通过 CLI 写一条记录

```
timedata log --start 09:00 --end 10:00 --category 投资/读书
        → CLI 校验参数（日期、时间段格式）
        → POST /api/entries
        → server 路由调 createEntryFromCliInput()
        → 服务端权威校验（时间段、分类存在、不重叠）
        → 写 SQLite
        → 返回 ok/错误
```

**CLI 不直接碰 SQLite**——它只是 server API 的客户端。这条规则是红线，详见 [`adr/0001-cli-as-only-write-path.md`](../adr/0001-cli-as-only-write-path.md)。

## 4. 启动顺序

### 4.1 服务端（`packages/server/src/index.ts`）

1. 创建 Hono app
2. 装 `secureHeaders` 中间件（全局 `*`）：注入 `Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`、`Strict-Transport-Security` 等安全响应头；CSP 故意留空，避免破坏生产 SPA 的内联样式
3. 装 CORS 中间件（`/api/*`，来源由 `ALLOWED_ORIGINS` 白名单控制，默认 `*`）
4. 装 `bodyLimit` 中间件（`/api/*`，上限由 `MAX_BODY_BYTES` 控制，默认 5 MB；`Content-Length` 超限会快速拒绝，无/未知长度 body 会先读取 cloned request 计数，超出返回 HTTP 413 且不消费原始 body）
5. 暴露不需要鉴权的两个路由：`/api/health`、`/api/version`
6. 装 auth 中间件（之后所有受保护的 `/api/*` 默认需要 Bearer Token；未设 `AUTH_TOKEN` 时 fail-closed，仅 `ALLOW_UNAUTHENTICATED_DEV=1` 显式开发旁路会放行）
7. 装 `rateLimit` 中间件（`/api/sync/*`，60s 窗口，上限 `SYNC_RATE_MAX` 次，默认 60；`/api/admin/*`，同窗口，上限 `ADMIN_RATE_MAX` 次，默认 120；超出返回 HTTP 429）
8. 注册业务路由：`categories`/`entries`/`sync`/`export`/`update`/`data`/`admin`（含 `sync-logs`）
9. 静态文件兜底：`public/` 服务客户端打包产物 + index.html SPA fallback
10. 调 `initializeDatabase()`：建表、首次启动播种默认分类
11. 启动时清理一次旧 server backup，并在 `SERVER_REPLICAS>1` 时提示 force-push token 仍是单实例内存存储
12. 监听 `PORT`（默认 3000）

### 4.2 Web 客户端（`packages/client/src/main.tsx`）

1. `seedDefaultCategories()`：本地分类表为空时插入默认两级分类
2. `<AppUpdateProvider>`：包住 PWA 自更新提示
3. `ErrorBoundary` 包裹 `BrowserRouter` / `SyncProvider` / `AppShell`，顶层渲染错误会落到统一错误页，避免整屏空白。
4. `SyncProvider` 包裹在 React Router 内、`AppShell` 外，为时间轴、记录编辑页、设置首页和数据设置页提供同一个客户端同步状态与触发入口。
5. React Router 装主路由：`/`、`/stats`、`/settings`（含子页 `/settings/server`、`/settings/data`、`/settings/admin-insights`、分类设置相关路由）、`/entries/:id/edit`
6. `<AppShell>` 统一监听 PWA/Android 从后台恢复到前台的事件，并把刷新信号传给时间轴和新增记录页，让这些页面重新读取当前时间。
7. `useMidnightTick`（`packages/client/src/hooks/useMidnightTick.ts`）在 `TimelinePage` 内独立调度本地午夜定时器，跨午夜后强制重新计算 `now`，避免长时间停留在前一天显示状态。
8. 重复性 prompt 走 `useConfirm` / `ConfirmDialog`，不直接调 `window.confirm`/`alert`，便于本地化和 Android WebView 体验统一。

### 4.3 CLI（`packages/cli/src/index.ts`）

每次调用都是冷启动：

1. 解析命令和 flags
2. `help` / `--help` 直接输出 JSON 帮助，不读取 server 配置
3. 未知命令在读取配置前返回 `UNKNOWN_COMMAND`
4. `doctor` 读取配置后执行只读诊断（配置、server 连通性、认证）
5. 数据命令解析 config（优先级：flag > 环境变量 > 配置文件）后路由到 `categories` / `list` / `log`
6. 输出 JSON（带 `ok: true/false`），按结果设置退出码

命令清单由 `packages/cli/src/commands/help.ts` 的 `commandRegistry` 统一维护：`runHelp()` 直接渲染它，`packages/cli/src/index.ts` 用 `commandRegistry.some(...)` 判断未知命令，并从中派生 `dispatchCommandNames`（去掉只读特例 `help` / `version`）。注册表覆盖测试在 `packages/cli/src/index.test.ts` 断言 `dispatchCommandNames` 等于注册表里所有需要运行时分发的命令，防止以后新增命令时漏接 dispatch。

### 4.4 Android 壳（`packages/mobile`）

1. 通过 `pnpm --filter @timedata/client build:mobile` 产出 `client/dist`（mobile 模式：相对路径 + 关闭 service worker）
2. `cap sync android` 把 `client/dist` 拷进 Android 工程的 `assets/public/`
3. Gradle 打 APK，WebView 加载本地静态文件
4. Android 系统返回键/边缘返回由 `packages/mobile` 注册的 `@capacitor/app` 原生插件转成 client 侧事件，再由 client 监听器桥接到 React Router 页面层级
5. Capacitor 配置要求 HTTPS scheme、禁用 cleartext 和 mixed content；开发或内网 HTTP 调试需要先明确改配置再同步 Android 工程
6. 同步靠用户在 App 内填 API 地址 + Token

## 5. 关键约定

1. **跨端契约只在 `packages/shared`**：`packages/shared/src/types.ts` 导出 `Category`、`TimeEntry`、`SyncChange`、`SyncPushOutcome`、`SyncPushReasonCode` 等静态类型，`packages/shared/src/schemas.ts` 导出对应运行时 schema，并在 server 路由和跨端同步边界收紧 UTC ISO 时间、`#RRGGBB` 色值、整数排序、非空字符串、`SyncLogEntry.synced` 的 `0 | 1` 数字状态、pull / force-push 请求形状等输入。改这些 = 改公开 API。同步契约还承载 seq cursor 字段（`baseSeq`、`sinceSeq`、`latestSeq`）、本地优先诊断字段（如 `overriddenRecordIds`、`backupId`），后台洞察契约承载最近同步问题和受保护备份元数据，三端展示/处理必须一起检查。
2. **时间用 ISO 字符串**：服务端 SQLite 的 `start_time` / `end_time` / `*_at` 都是字符串字段，比较直接靠字典序。Dexie 同样存字符串。
3. **写入路径只有两条**：用户在 Web 端通过组件 → Dexie；脚本/AI 通过 CLI → HTTP API → SQLite。**不存在第三条**。服务器不再暴露 JSONL/CSV 导入写库接口；`GET /api/export` 只读，`POST /api/data/reset` 是人工维护入口，必须先调用 `/api/data/reset/prepare` 拿短时确认 token 并提交确认短语。
4. **服务端是权威**：时间段重叠、分类存在、archived、时间格式合法等的最终判定都在 `packages/server/src/sync/validation.ts` 和 `packages/server/src/lib/entry-service.ts`。同步校验里需要按应用时区比较当前时间的逻辑统一走 `packages/server/src/lib/timezone.ts`；client / CLI 的同名校验只是为了体验，不能让 server 跳过。
5. **SQL 字段名 vs JS 字段名**：服务端 SQLite 用 `snake_case`（`parent_id`、`start_time`），跨边界（路由 / 同步 / 后台洞察）时手工映射成 JS 的 `camelCase`（`parentId`、`startTime`）。这是**手工映射**，没有 ORM。
6. **后台洞察只读**：`/api/admin/*` 的概览、最近记录、分类汇总、同步诊断、备份元数据、健康检查和基础分析保持只读；受控维护端点（如 `/api/admin/sync-logs`）必须有独立校验和显式确认保护。admin 路由复用现有 Bearer Token 鉴权，不提供任意 SQL。
   - 代码入口：`packages/server/src/routes/admin.ts`、`packages/server/src/index.ts`、`packages/client/src/lib/adminApi.ts`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx`、`packages/client/src/pages/SettingsPage.tsx`、`packages/client/src/App.tsx`
   - 相关测试：`packages/server/src/routes/admin.test.ts`、`packages/client/src/lib/adminApi.test.ts`、`packages/client/src/pages/settings/SettingsAdminInsightsPage.test.tsx`、`packages/client/src/pages/SettingsPage.test.tsx`
7. **分类管理页负责分类排序、重命名、新增、归档、直接删除和颜色调整**：`Category.sortOrder` 是同一个 `parentId` 作用域内的展示顺序。Web 分类管理页用 dnd-kit 做拖拽手柄，一级分类只能和一级分类重排，子分类只能在同一个父分类下重排；松手后批量更新 Dexie 的 `categories.sortOrder` / `updatedAt`，并为每个变化项写 `syncLog`，后续仍走现有同步推送。新增分类和重命名都会 trim 名称并拒绝空名；同层级未归档分类重名会被拒绝。分类重命名只改 `Category.name` / `updatedAt`，不改 `Category.id`，并同步更新本地 `autoBackups` 里同 ID 分类的名称。归档保留分类行，更新 `isArchived` / `updatedAt`，并写 `syncLog` update 后走 `categories/update`；归档 mutation 在 `useCategories.ts` 中以 `archiveCategory()` 单独导出，同时仍由 `useCategories()` 暴露给页面。直接删除会删除目标分类、后代分类和关联记录，并走 `categories/delete` / `time_entries/delete` 同步。颜色只在一级分类上调整，子分类跟随父分类；一键配色按当前未归档一级分类顺序循环应用预设色板。
   - 代码入口：`packages/client/src/pages/settings/SettingsCategoriesPage.tsx`、`packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx`、`packages/client/src/components/SortableCategoryItem.tsx`、`packages/client/src/hooks/useCategories.ts`、`packages/client/src/lib/categorySort.ts`、`packages/client/src/lib/categoryColors.ts`
   - 相关测试：`packages/client/src/lib/categorySort.test.ts`、`packages/client/src/lib/categoryColors.test.ts`、`packages/client/src/hooks/useCategories.test.ts`、`packages/client/src/pages/settings/SettingsCategoriesPage.test.tsx`、`packages/client/src/pages/settings/SettingsCategoryDetailPage.test.tsx`

## 6. 模块速查（结合代码路径）

| 模块 | 关键入口 | 进一步阅读 |
|---|---|---|
| 数据模型 | `packages/shared/src/types.ts`、`packages/shared/src/schemas.ts` | [`data-model.md`](./data-model.md) |
| 同步推/拉 | `packages/server/src/sync/`、`packages/client/src/sync/` | [`sync.md`](./sync.md) |
| Backup | `packages/client/src/backup/` | [`backup.md`](./backup.md) |
| CLI 命令 | `packages/cli/src/commands/` | [`cli.md`](./cli.md) |
| 部署 / 自更新 | `docker-compose.yml`、`packages/server/src/lib/update.ts` | [`deployment.md`](./deployment.md) |
| 审查 / 排期边界 | `AGENT.md` | [`AGENT.md#项目定位边界`](../../AGENT.md#项目定位边界) |

## 7. 不在这份文档里的事

- 函数实现（让代码说话）
- 本地开发过程计划（看本地-only 的 `docs_local/plans/`）
- 本地设计规格（看本地-only 的 `docs_local/specs/`）
- 第三方审核材料（看 `docs/TimeData-project-review-brief.md`）
