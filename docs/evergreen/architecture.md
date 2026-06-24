---
type: evergreen
title: 架构总览
covers:
  - package.json
  - pnpm-workspace.yaml
  - packages/shared/src/index.ts
  - packages/client/src/main.tsx
  - packages/client/src/App.tsx
  - packages/client/src/components/app-shell/AppRoutes.tsx
  - packages/client/src/components/app-shell/DesktopSidebar.tsx
  - packages/client/src/components/app-shell/MobileBottomNav.tsx
  - packages/client/src/components/ErrorBoundary.tsx
  - packages/client/src/contexts/BottomNavContext.tsx
  - packages/client/src/contexts/SyncContext.tsx
  - packages/server/src/index.ts
  - packages/cli/src/index.ts
  - packages/mobile/capacitor.config.ts
  - packages/mobile/android/app/src/main/AndroidManifest.xml
last-reviewed: 2026-06-24
---

# 架构总览

> 这份文档是 TimeData 的系统地图：五个包的关系、主要数据流、启动顺序、关键约定和文档登记簿。
> 具体功能域的字段、页面、路由和测试不在这里展开，去对应 evergreen 子文档。

## 1. 一句话定位

TimeData 是个人时间记录 PWA：

- 本地优先：Web 端先写 IndexedDB，再异步同步。
- 自托管：服务端是 Hono + SQLite，负责最终校验、写入、同步账本和受控 API。
- 多入口：Web/PWA、CLI、Android WebView；授权 agent 只能经服务端受控 API 写入。
- 数据域：时间记录、分类/设置、速记、待办、任务轨道、目标层、健康数据、统计/洞察、同步、备份。

**不做**：多用户、协作、SaaS、复杂权限、AI 直接写 DB 或备份/导出文件。

## 2. 五个包的职责与依赖

```text
shared  类型、schema、同步域登记簿、常量、跨端纯函数（completeTask / 重复规则 / 日期助手 / 轨道看板信号 / 目标布局钉点 key helper）
   ▲
   ├── client  React + Dexie，本地优先 UI 与同步客户端
   ├── server  Hono + SQLite，鉴权、权威校验、同步账本、静态文件
   └── cli     Node CLI，server API 的受控封装

mobile   Capacitor Android 壳，webDir 指向 client/dist
```

依赖方向单向：`client` / `server` / `cli` 都依赖 `shared`，彼此不 import。它们靠 HTTP API、同步账本和共享类型契约协作。`mobile` 不写业务逻辑，只包装前端构建产物与原生配置。

根 `package.json` 只做 workspace 脚本编排：构建先产出 `shared`，再并行跑 client/server/cli；测试允许 package 间有限并行并在最后串起根目录脚本测试。本地命令细节见 [development](development.md)，CI 顺序见 [deployment](deployment.md)。

## 3. 总体数据流

### 3.1 本地优先写入

Web 端用户写入时，业务表 mutation 与 `syncLog(synced=0)` 必须在同一个 Dexie transaction 内完成。随后 `regularSync()` 把待同步变更 push 到 server，server 校验并分配 `sync_seq` / `updated_at`，其他设备按 seq pull。

时间记录与时间轴见 [timeline](timeline.md)；速记见 [quick-notes](quick-notes.md)；待办见 [todo](todo.md)；任务轨道见 [tracks](tracks.md)；目标层见 [goals](goals.md)；分类与设置见 [categories-settings](categories-settings.md)；健康见 [health](health.md)。

### 3.2 服务端受控写入

CLI、agent、Garmin、ingest 等脚本入口都必须经 server API 或 server 内部受控服务写入。server 是最终裁判：时间合法性、分类存在性、重叠、认证、同步序列和时间戳都由 server 判定或分配。

CLI 写时间记录见 [cli](cli.md) 与 [timeline](timeline.md)；agent 投递速记见 [quick-notes](quick-notes.md)；agent 回写任务见 [todo](todo.md)；agent 写任务轨道见 [tracks](tracks.md)；Garmin/ingest 见 [health](health.md)。

### 3.3 同步与备份

同步使用服务端 `sync_seq` 账本模型，每台设备只保存一个 `sinceSeq` 读数。普通同步先预检本地未同步日志与云端 latestSeq；必要时创建自动备份，再 push/pull。同步不是备份，恢复备份不会自动覆盖服务器。

同步机制见 [sync](sync.md)，备份格式和恢复规则见 [backup](backup.md)。

### 3.4 统计与终端视图

统计页只读 `timeEntries/categories/settings` 或健康 Dexie 表，写入仅限 UI 设置。时间统计与洞察见 [stats-insights](stats-insights.md)，健康仪表盘见 [health](health.md)。

## 4. 启动顺序

### 4.1 服务端

`packages/server/src/index.ts`：

1. 创建 Hono app。
2. 装安全响应头、CORS、body limit。
3. 暴露 `/api/health` 与 `/api/version`。
4. 先挂 `/api/agent/*` scoped auth，再挂普通 `/api/*` Bearer auth；未配置 `AUTH_TOKEN` 默认 fail-closed。
5. 装 sync/admin rate limit。
6. 注册业务路由：agent 任务回写、agent 轨道 ingest、categories、entries、quick-notes、tasks、sync、export、update、data、admin、health ingest、Garmin admin。
7. 服务静态前端产物与 SPA fallback。
8. `initializeDatabase()` 建表、补列、播种默认分类、处理一次性迁移。
9. 清理旧 server backup，加载 Garmin 配置并注册定时器。
10. 监听 `PORT`。

### 4.2 Web 客户端

`packages/client/src/main.tsx`：

1. `seedDefaultCategories()` 在本地分类为空时播种默认分类。
2. `migrateLocalSettingsToDexie()` 把旧 localStorage 设置迁入 Dexie settings。
3. `runSchemaNormalizationIfNeeded()` 按 shared schema 做 IndexedDB 本地卫生归一（补默认、剥孤儿、坏行保留并 warn），成功后推进本地版本闸。
4. 检查 `#root` 挂载点。
5. `<AppUpdateProvider>`、`ErrorBoundary`、`BrowserRouter`、`SyncProvider`、`BottomNavProvider`、`AppShell` 依次包裹。
6. Router 注册时间轴、速记、待办、轨道、目标、时间/健康统计、设置及记录编辑路由；AppShell 按 `1024px` viewport 断点分流：窄屏 / APK 渲染底部纯图标导航并继续使用 `nav.visibleTabs.v1`，宽屏渲染左侧固定纯图标侧栏并使用 `nav.desktopSidebar.v1` 的排序 / 更多收纳配置。目标详情 `/goals/:id` 与轨道详情 `/tracks/:id` 在窄屏隐藏底部导航，宽屏仍保留桌面侧栏；设置子路由包含导航、轨道行动标签、统计布局、健康范围、服务端/数据/管理等入口，具体归属见各主题文档。
7. `SyncProvider` 在云同步开启且配置完整时维护 SSE，并在远端 seq 前进时防抖触发普通同步；时间轴兜底同步的节流与失败后立即重试语义见 [sync](sync.md)。

### 4.3 CLI

`packages/cli/src/index.ts`：

1. 解析 argv 与配置。
2. 对命令参数做体验侧校验。
3. 调 server API。
4. 格式化输出给人或脚本。

CLI 不直接读写 SQLite。命令面见 [cli](cli.md)。

### 4.4 Android 壳

`packages/mobile/capacitor.config.ts` 指向 `../client/dist`。Android 原生工程只承载壳、权限、图标和 Capacitor 插件配置；业务逻辑仍在 client。

## 5. 关键约定

1. **写入边界**：Web 本地写 Dexie；脚本/AI/agent 经 server API；server 内部受控服务可写 SQLite 并追加 `sync_seq`。禁止直接编辑 SQLite / IndexedDB / syncLog / Backup / JSONL / CSV。
2. **服务端最终裁判**：client / CLI 校验只为体验，不能让 server 跳过权威校验。
3. **时间一律 UTC ISO**：存储和传输都带 `Z`，展示再转本地。
4. **SQL snake_case，JS camelCase**：手工映射，没有 ORM。
5. **同步域登记簿封闭**：新增域必须改 `packages/shared/src/syncDomains.ts` 和 `packages/server/src/sync/domains.ts`，见 [ADR 0012](../adr/0012-sync-ledger-and-domain-registry.md)。
6. **SyncPushReasonCode 封闭**：扩展必须同步 server validation、client engine 和文档。
7. **Sync ≠ Backup**：同步是多设备一致性，备份是防误删。

## 6. 文档登记簿

文档组织规则、主题轴（域/模块/设计语言/横切）判定树、单轴 covers 归属、骨架模板和体量阈值见 [_docs-guide](_docs-guide.md)。本登记簿只列**主题文档**；主题膨胀后外提的子文档由各自主题文档在“子文档索引”里登记，不在此重复（当前有子文档的主题：health、todo、categories-settings、design-language）。

| 文档 | 类型 | 职责 |
|---|---|---|
| [_docs-guide](_docs-guide.md) | 横切 | evergreen 文档组织规则、骨架模板、毕业阈值、体量棘轮 |
| [architecture](architecture.md) | 横切 | 系统地图、五包关系、启动顺序、文档登记簿 |
| [data-model](data-model.md) | 横切 | 跨域数据契约、全表索引脉、同步信封、时间/ID/映射约定 |
| [development](development.md) | 横切 | 开发流程、测试分层、工程约定 |
| [deployment](deployment.md) | 横切 | 部署、环境变量、Docker、自更新 |
| [security](security.md) | 横切 | 鉴权、token、CORS、安全边界 |
| [cli](cli.md) | 横切 | CLI 命令面、参数校验、输出契约 |
| [sync](sync.md) | 域 | 同步账本、域登记簿、push/pull、冲突、force-push |
| [backup](backup.md) | 域 | Backup 格式、导出/导入、自动备份、恢复边界 |
| [timeline](timeline.md) | 域 | 时间记录、时间轴、跨夜、时间选择、相邻合并 |
| [quick-notes](quick-notes.md) | 域 | 速记表、聊天式速记页、CLI 只读、agent 投递 |
| [todo](todo.md) | 域 | 待办任务、重复规则、子任务、agent 状态回写 |
| [tracks](tracks.md) | 域 | 任务轨道、轨道步骤、状态线数据地基、agent ingest |
| [goals](goals.md) | 域 | 目标层、Task/Track 成员引用、项目完成度、主题 7 天活跃度、前置关系 |
| [health](health.md) | 域 | Garmin、ingest、健康 schema、健康图表配置、健康页 |
| [stats-insights](stats-insights.md) | 域 | 时间统计、洞察模块、统计布局和趋势设置 |
| [categories-settings](categories-settings.md) | 域 | 分类 schema、分类管理、排序/颜色/删除、sleep/punch 分类设置 |
| [design-language](design-language.md) | 设计 | 五层颜色 token、字体栈、圆角/边框/阴影、自绘控件库、Phosphor 图标、视觉红线 |

## 7. 不在这份文档里的事

- 具体字段 schema、页面细节、路由细节和测试清单。
- 本地过程文档、spec、plan、review；这些在 `docs_local/**`。
- ADR 正文；ADR 仅追加，不在 architecture 复述。
