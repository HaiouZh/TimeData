---
type: evergreen
title: 健康数据
covers:
  - packages/shared/src/healthSchemas.ts
  - packages/shared/src/chartSchemas.ts
  - packages/shared/src/syncDomains.ts
  - packages/shared/src/types.ts:SyncChange
  - packages/server/src/db/schema.ts
  - packages/server/src/lib/healthRows.ts
  - packages/server/src/lib/chartRows.ts
  - packages/server/src/sync/domains.ts
  - packages/client/src/db/index.ts
  - packages/client/src/sync/clientDomains.ts
  - packages/server/src/garmin/**
  - packages/server/src/routes/ingest.ts
  - packages/client/src/pages/settings/SettingsGarminPage.tsx
  - packages/client/src/pages/HealthStatsPage.tsx
  - packages/client/src/pages/stats/health/**
  - packages/client/src/lib/healthMetrics/**
  - packages/client/src/lib/healthBlocks/**
  - packages/client/src/lib/healthCharts.ts
  - packages/client/src/lib/healthUtils.ts
  - packages/client/src/lib/settings/healthRangeSetting.ts
  - packages/client/src/pages/settings/SettingsHealthRangePage.tsx
last-reviewed: 2026-06-18
---

# 健康数据

> 健康域覆盖 Garmin 抓取、HTTP ingest、健康原始数据 schema、`health_charts` 视图块配置和 `/stats/health` 展示。
> 时间投入统计与洞察见 [stats-insights](stats-insights.md)；健康数据不参与时长统计。

## 承上启下

- 上游：Garmin 定时/手动抓取，或受保护 `/api/health/ingest` 批量导入。
- 下游：服务端 `safeParse → applyChange() → sync_seq → notifySyncChange()` 写入，客户端普通同步拉取到 Dexie，再由健康页渲染。
- 契约：健康表与图表配置 schema 见本文 §2；同步账本见 [sync](sync.md)；跨域字段约定见 [data-model](data-model.md)。
- 邻居：[stats-insights](stats-insights.md) 只拥有时间统计/洞察，不展开健康 schema；[security](security.md) 关注 token 和凭证安全。

## 1. 数据流

### 1.1 Garmin 抓取

```text
/api/admin/garmin/fetch 或定时器
→ garminService.resolveGarminFetchRange()
→ Python 子进程 garminFetch.py
→ garminconnect 登录 Garmin Connect
→ 逐日拉 heart_rate / hrv / sleep / stress / running activities
→ stdout 输出 camelCase JSON
→ TS 解析每域 records
→ sharedDomain.dataSchema.safeParse()
→ ingestGarminDomain()
→ applyChange()
→ SQLite 健康表 + sync_seq
→ notifySyncChange(latestSeq)
→ 客户端 SSE bump 后普通 pull
→ HealthStatsPage 从 Dexie 渲染
```

Python 只负责抓取和格式化，不直接碰 SQLite。自动抓取窗口看 `health_heart_rate`、`health_hrv`、`health_sleep`、`health_stress` 四个日汇总域的最新日期，补最早缺口到昨天；完全无数据时按 `initialBackfillDays` 首次回填（默认 7，范围 1..30）。

`runs` 不参与缺口判断，因为“没有跑步”不等于数据缺失。手动抓取可指定日期范围或最近 N 天，最多 90 天，不能抓未来。

### 1.2 HTTP ingest

```text
POST /api/health/ingest { domain, records }
→ authMiddleware 校验 Bearer Token
→ 只允许 health_heart_rate / health_hrv / health_sleep / health_stress / runs
→ 每条 record 过对应 shared schema safeParse
→ applyChange()
→ sync_seq
→ notifySyncChange()
```

Garmin 服务内部直接调用 `applyChange()`，不经 HTTP 端点；`/api/health/ingest` 保留给脚本迁移历史数据。

### 1.3 客户端渲染

客户端 pull 后把健康域映射到 Dexie `healthHeartRate`、`healthHrv`、`healthSleep`、`healthStress`、`runs`、`healthCharts`。`HealthStatsPage` 用 `useLiveQuery` 读取健康表和图表配置；顶部范围按钮来自同步设置 `health.range.presets`；`HealthBlockList` 按 `block.view/source` 分发到统计卡、趋势图、指标表或跑步表。

`health_charts` 是健康视图块配置同步域，不是健康原始数据。默认 seed 两块：“健康摘要”和“健康趋势”；跑步表不再写死在页面里，由搭建器创建。

## 2. Schema / 契约

健康原始数据 schema 在 `packages/shared/src/healthSchemas.ts`，SQLite 行映射在 `packages/server/src/lib/healthRows.ts`。

| 域 | 主要字段 | 说明 |
|---|---|---|
| `health_heart_rate` | `id`、`date`、`restingHeartRate`、`minHeartRate`、`maxHeartRate`、`avgHeartRate`、`last7DaysAvgRestingHeartRate`、`createdAt`、`updatedAt` | 非 tombstone 行按 `date` 唯一 |
| `health_hrv` | `id`、`date`、`hrvMs`、`createdAt`、`updatedAt` | 按日期唯一 |
| `health_sleep` | `id`、`date`、`sleepStart`、`wakeTime`、`adjustmentHours`、`createdAt`、`updatedAt` | `sleepStart/wakeTime` 是 `HH:MM` |
| `health_stress` | `id`、`date`、`stress`、`createdAt`、`updatedAt` | 按日期唯一 |
| `runs` | `id`、`date`、`startTime`、`distanceKm`、`durationSeconds`、`averageHeartRate`、`averageCadence`、`averageStrideM`、`averageVerticalRatioPercent`、`averageVerticalOscillationCm`、`averageGroundContactMs`、`type`、`city`、`createdAt`、`updatedAt` | `date` 是普通索引，不唯一 |
| `health_charts` | `id`、`type`、`sortOrder`、`config`、`createdAt`、`updatedAt` | `config` 是 `HealthChartConfig` JSON |

健康数据域是同步 LWW 域，`countsInStatus=false`，不进入 `/api/sync/status` 的公开业务计数。`health.range.presets` 是 settings 键值，不是 `health_charts` 配置。

## 3. 关键不变量 / 坑 / 红线

- Garmin 与 ingest 都必须走服务端受控写入；任何脚本都不能直接编辑 SQLite、Dexie、syncLog、备份或导出文件。
- Garmin 凭证存在 `server_config`，密码 AES-256-GCM 加密，密钥派生自 `AUTH_TOKEN`；`server_config` 不同步到客户端。
- 健康数据不参与时间段重叠校验、分类统计、时长统计或 `/api/sync/status` 业务计数。
- `runs` 不参与自动抓取缺口判断。
- `health_charts` 的 `sortOrder/config` 变更要和 `syncLog(tableName="health_charts")` 同事务写入。
- `routes/admin/health.ts` 是后台系统健康检查，不属于本文健康数据域；不要因为文件名相同把它归入 Garmin/健康数据契约。

## 4. 模块速查

| 关注点 | 入口 |
|---|---|
| 契约 | `packages/shared/src/healthSchemas.ts`、`packages/shared/src/chartSchemas.ts`、`packages/shared/src/syncDomains.ts` |
| SQLite / row mapper | `packages/server/src/db/schema.ts`、`packages/server/src/lib/healthRows.ts`、`packages/server/src/lib/chartRows.ts` |
| 同步域 | `packages/server/src/sync/domains.ts`、`packages/client/src/sync/clientDomains.ts` |
| Garmin | `packages/server/src/garmin/**`、`packages/client/src/pages/settings/SettingsGarminPage.tsx` |
| ingest | `packages/server/src/routes/ingest.ts` |
| 健康页 | `packages/client/src/pages/HealthStatsPage.tsx`、`packages/client/src/pages/stats/health/**` |
| 指标与视图块 | `packages/client/src/lib/healthMetrics/**`、`packages/client/src/lib/healthBlocks/**`、`packages/client/src/lib/healthCharts.ts` |
| 范围设置 | `packages/client/src/lib/settings/healthRangeSetting.ts`、`packages/client/src/pages/settings/SettingsHealthRangePage.tsx` |
| 代表测试 | `garminService.test.ts`、`garminRoutes.test.ts`、`HealthStatsPage.test.tsx`、`MetricChartBlock.test.tsx`、`healthMetrics/*.test.ts`、`healthBlocks/*.test.ts`、`chartSchemas.test.ts`、`sync/health-charts.e2e.test.ts` |

## 深水细节

健康页目前把图表搭建器、块级范围、CSV 导出、跑步表和趋势图都放在同一域内。若 `healthCharts` 配置编辑器继续扩张并形成独立 covers 簇，可按 [_docs-guide](_docs-guide.md) 外提。
