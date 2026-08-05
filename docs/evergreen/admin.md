---
type: evergreen
title: 服务端数据洞察
covers:
  - packages/shared/src/admin-schemas.ts
  - packages/client/src/lib/adminApi.ts
  - packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx
  - packages/server/src/middleware/validate.ts
  - packages/server/src/routes/admin/index.ts
  - packages/server/src/routes/admin/_helpers.ts
  - packages/server/src/routes/admin/analytics.ts
  - packages/server/src/routes/admin/categories.ts
  - packages/server/src/routes/admin/entries.ts
  - packages/server/src/routes/admin/health.ts
  - packages/server/src/routes/admin/summary.ts
  - packages/server/src/routes/admin/sync.ts
contracts:
  - packages/server/src/middleware/validate.ts
  - packages/shared/src/admin-schemas.ts
  - packages/server/src/routes/admin/index.ts
  - packages/server/src/routes/admin/analytics.ts
  - packages/server/src/routes/admin/categories.ts
  - packages/server/src/routes/admin/entries.ts
  - packages/server/src/routes/admin/health.ts
  - packages/server/src/routes/admin/summary.ts
  - packages/server/src/routes/admin/sync.ts
last-reviewed: 2026-08-05
---

# 服务端数据洞察

> 本文管 `/settings/admin-insights` 与只读 `/api/admin/*` 洞察端点：服务器概览、最近记录、分类汇总、同步诊断、健康检查和基础分析。
> 不管服务端备份删除 / 配置写入、TOTP 管理和请求审计新来源确认；这些属于 [backup](backup.md) 与 [security](security.md)。

## 1. 边界

`/api/admin/*` 挂在普通 `/api/*` Bearer 鉴权之后，只接受 master `AUTH_TOKEN`；`AGENT_TOKEN` 不能访问 admin 命名空间。admin 命名空间复用 admin rate limit，不暴露任意 SQL。

本页拥有的洞察端点全是 GET 只读：

| 端点 | 作用 |
|---|---|
| `GET /api/admin/summary` | 分类、记录、sync logs、tombstones、server backups 的轻量总览，以及最近记录 / 同步 / 备份时间 |
| `GET /api/admin/entries` | 最近记录列表，支持异常筛选、分页和日期范围 |
| `GET /api/admin/categories` | 分类汇总，包含归档分类、记录数与正时长分钟数 |
| `GET /api/admin/sync` | 最近 50 条服务端同步日志、rejected/conflict 计数和部分近期问题 |
| `GET /api/admin/health-checks` | 时间记录健康检查：无效时长、缺分类、归档分类、重叠 |
| `GET /api/admin/analytics` | 按时间桶与分类做基础聚合 |

同一 admin router 还挂载备份、备份配置、请求日志、TOTP 和 sync-log 清空等端点；这些端点的写入边界由对应主题文档承载。`SettingsAdminInsightsPage` 的洞察区只读；备份管理卡片调用的是 [backup](backup.md) 的端点。

## 2. 响应契约

所有响应形状由 `packages/shared/src/admin-schemas.ts` 定义；客户端 `adminApi.ts` 以这些类型封装调用。服务端路由参数通过 `middleware/validate.ts` 的 zod middleware 校验，查询错误返回统一的 `{ ok:false, error:{ code, message, details? } }` 形状。

`AdminEntriesResponse` 的记录按 `start_time DESC, id DESC` 稳定倒序；`limit` 受 schema 限制，异常筛选只覆盖 `invalid_time_range`、`missing_category`、`archived_category`。重叠记录属于 health checks，不属于 entries 的 anomaly 过滤。

`AdminSyncResponse.recentIssues` 只从 `categories` 与 `time_entries` outcomes 抽取问题明细并截断到 20 条；其他同步域的 rejected/conflict 仍进入计数和原始日志，但不进该明细数组。深入排障见 [sync/troubleshooting](sync/troubleshooting.md)。

## 3. 健康与分析口径

健康检查有四类：`invalid_time_range`、`missing_category`、`archived_category`、`overlap`。每类返回 count 与最多 5 个 sampleIds；这是时间记录数据卫生检查，不是已退役健康数据域。

基础分析读取 `from` / `to` / `groupBy` 查询参数：`groupBy` 允许 `day`、`week`、`month`，三档都真的换桶，桶键由 `analyticsBucketExpression` 生成，均为可按字典序排序的字符串：

| groupBy | bucket 表达式 | bucket 形如 |
|---|---|---|
| `day` | `substr(start_time,1,10)` | `2026-05-08` |
| `week` | `date(substr(start_time,1,10),'weekday 0','-6 days')` | `2026-05-04`（该周周一） |
| `month` | `substr(start_time,1,7)` | `2026-05` |

周桶**以周一为一周起点**，桶键取该周周一的日期串，与客户端 `lib/time.ts` 的 `startOfWeek` / `lib/diary/reviewDates.ts` 的 `isoWeekMonday` 同口径。不用 `strftime('%Y-%W')`：它跨年会把同一周劈成 `2026-52` 与 `2027-00` 两个桶。三档桶键都直接由 `start_time` 的 **UTC 日期**切分（不经 `APP_TIME_ZONE` 转本地日），因此边界与前端按本地日聚合的统计洞察可能差一天。`SettingsAdminInsightsPage` 目前固定以 `groupBy: "day"` 拉取并原样渲染 bucket 字符串，`week` / `month` 只对直接调 API 的消费者可用。时间桶和分类聚合都只计 `end_time > start_time` 的正时长；分类名缺失时回退成 `category_id` 本身（`COALESCE(c.name, e.category_id)`，不是空字符串），颜色缺失回退 `#808080`。

## 4. 模块速查

| 关注点 | 入口 |
|---|---|
| shared 响应 schema | `packages/shared/src/admin-schemas.ts` |
| 客户端 API | `packages/client/src/lib/adminApi.ts` |
| 设置页 | `packages/client/src/pages/settings/SettingsAdminInsightsPage.tsx` |
| admin router | `packages/server/src/routes/admin/index.ts` |
| 洞察端点 | `routes/admin/{summary,entries,categories,sync,health,analytics}.ts` |
| 聚合 helper | `routes/admin/_helpers.ts` |
