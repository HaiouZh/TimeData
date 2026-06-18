---
type: evergreen
title: 健康 · 视图块配置与渲染
covers:
  - packages/shared/src/chartSchemas.ts
  - packages/server/src/lib/chartRows.ts
  - packages/client/src/lib/healthCharts.ts
  - packages/client/src/lib/healthMetrics/**
  - packages/client/src/lib/healthBlocks/**
  - packages/client/src/pages/stats/health/**
  - packages/client/src/lib/settings/healthRangeSetting.ts
  - packages/client/src/pages/settings/SettingsHealthRangePage.tsx
last-reviewed: 2026-06-18
---

# 健康 · 视图块配置与渲染

> [health](../health.md) 的展示层**子文档**：健康数据怎么变成统计卡/趋势图/指标表/跑步表。
> 讲什么：`health_charts` 视图块配置 schema、默认块、有效块组合、指标引擎（healthMetrics）、块数据层（healthBlocks）、范围设置。
> 不讲什么：5 指标表 schema（见 [health](../health.md)）、数据怎么进库（见 [health/garmin-ingest](garmin-ingest.md)）。

## 承上启下

- **上游**：Dexie 5 张健康表（由 [health/garmin-ingest](garmin-ingest.md) 写入、[sync](../sync.md) 下发）+ `health_charts` 配置同步域。
- **下游**：`/stats/health` 终端视图，无下游。
- **契约**：`HealthChartConfigSchema` 在 `chartSchemas.ts`（**不在** `healthSchemas.ts`）；它是配置，不是健康原始数据。
- **邻居**：[health](../health.md)（主题）、[health/garmin-ingest](garmin-ingest.md)（同域另一子文档）、[stats-insights](../stats-insights.md)（`/stats/time` 平级页，无文件交叠）。

## 1. health_charts 视图块配置 schema（`chartSchemas.ts`）

`HealthChartConfigSchema` 是 `StatBlockSchema` / `ChartBlockSchema` / `TableBlockSchema` 在 `view` 上的 discriminatedUnion：

| 块 | view | source 允许 | 关键字段 |
|---|---|---|---|
| 统计卡 | `stat` | `derived`（仅此） | metricIds[1..]、aggregation? |
| 趋势图 | `chart` | `healthMetricDaily` \| `runs` | metricIds[1..]、chartKind(line/area/bar)、trendMode(auto/normalized/raw)、rollingWindows[int+]、showAverageLine |
| 指标表/跑步表 | `table` | `healthMetricDaily` \| `runs` | columnIds[1..]、rollingWindows、showRawColumns、showRollingColumns、hideEmptyRows、maxRows |

- `HealthBlockRangeSchema`：`inherit` \| `recent{days}` \| `manual{from,to}` \| `all`。
- `ColorRuleSchema`：`{fieldId, operator: lt/lte/gt/gte/between, value, valueTo?, tone: bad/warn/good/info}`。
- `BlockPresentationSchema`：`{exportEnabled?, colorRules?, height?, yAxis?}`。

**SQLite vs 同步传输格式差异**：SQLite `health_charts` 存打包格式 `(id, type, sort_order, config JSON, created_at, updated_at)`；Dexie / SyncChange 传展开的 `HealthChartConfig`。映射在 `chartRows.ts`：`type=view`、`sort_order=order`、`config=JSON.stringify(块)`；`rowToHealthChart` 用 row 的 id/order/createdAt/updatedAt 覆盖 JSON 内同名字段。

### 1.1 默认注入的块

`seedDefaultHealthChartsOnce`（`healthCharts.ts`，`SEEDED_FLAG="health.charts.seededV2"` 存 settings 表）注入 2 块：**健康摘要**（`stat+derived`，5 个 metricIds，order 0）+ **健康趋势**（`chart+healthMetricDaily`，4 个 metricIds，line/auto/rollingWindows[7]，order 1）。**跑步表不默认注入**，由 `ChartBuilderSheet` 手动添加。

## 2. 指标引擎与块数据层

- **指标引擎 `healthMetrics/`**：`registry.ts`（13 个 `DailyMetricDef`）、`chartSeries.ts`（日期枚举 + rolling）、`chartDisplay.ts`（raw-single/dual-axis/index 布局 + Y domain）、`aggregate.ts`（latest/avg/max/min/sum 五种聚合）、`format.ts`（睡眠时长/配速/时钟/距离）、`types.ts`。
- **块数据层 `healthBlocks/`**：`range.ts`（块级范围解析）、`summary.ts`（统计卡数据）、`tableData.ts`（指标表 + 跑步表数据）、`csv.ts`（CSV 导出）。
- **页面渲染 `pages/stats/health/`**：`HealthBlockList.tsx` 按 `block.view + block.source` 分发；`MetricChartBlock.tsx`（recharts 趋势图）、`MetricTableBlock.tsx`、`RunTableBlock.tsx`、`HealthSummaryCards.tsx`、`ChartBuilderSheet.tsx`（增删改块）、`chartColors.ts`（DATA_PALETTE / metricColor / semanticColor）。
- **范围设置**：`healthRangeSetting.ts` 页面级 6 档预设（`7,30,90,180,365,all`，key `health.range.presets`，默认 "30"）；设置页 `SettingsHealthRangePage.tsx`。

## 3. 关键不变量 / 坑 / 红线

1. **有效块组合仅 4 种**：`stat+derived`、`chart+healthMetricDaily`、`table+healthMetricDaily`、`table+runs`。`chart+runs` schema 允许但 UI 不创建、渲染器不渲染（死组合）。
2. **`health_charts` 是同步 LWW 域**；`sortOrder/config` 变更要和 `syncLog(tableName="health_charts")` 同事务写入。
3. **配置 vs 原始数据**：`health.range.presets` 是 settings 键值，不是 `health_charts` 配置；别混。
4. **打包/展开两套格式**：改 `chartRows.ts` 映射时注意 SQLite 打包格式与同步展开格式的字段覆盖顺序。
5. **recharts 不解析 CSS `var()`**：图表配色须把 token 镜像成 JS 常量（`chartColors.ts`），不能直接传 `var(--…)`。

## 4. 模块速查

| 关注点 | 入口 |
|---|---|
| 配置 schema | `shared/src/chartSchemas.ts` |
| SQLite 打包↔展开映射 | `server/src/lib/chartRows.ts` |
| Dexie CRUD + 默认块注入 | `client/src/lib/healthCharts.ts` |
| 指标引擎 | `client/src/lib/healthMetrics/**` |
| 块数据层 | `client/src/lib/healthBlocks/**` |
| 页面渲染 | `client/src/pages/stats/health/**` |
| 范围设置 | `client/src/lib/settings/healthRangeSetting.ts`、`pages/settings/SettingsHealthRangePage.tsx` |

**测试**：`chartSchemas.test.ts`（`HealthChartConfigSchema` 校验 / 拒绝旧 type-based 块）、`chartRows.test.ts`、`sync/health-charts.e2e.test.ts`（同步回环）、`healthCharts.test.ts`、`healthMetrics/{chartSeries,chartDisplay,aggregate,format,registry}.test.ts`、`healthBlocks/{range,summary,tableData,csv}.test.ts`、`pages/stats/health/{chartColors,MetricChartBlock,ChartBuilderSheet}.test.{ts,tsx}`、`healthRangeSetting.test.ts`。

## 深水细节

- **`lib/healthUtils.ts` 是孤儿模块**（grep 全仓无 import）：旧 API（`filterByDateRange` 用 3 档 vs `healthRangeSetting` 6 档），已被 `healthMetrics/*` + `healthBlocks/*` 配置化系统替代。**不进任何 covers**，待清理。
- **旧架构残留**：`RunPaceTrendChart.tsx`、`buildHealthSummary`/`buildNormalizedHealthTrend`/`buildRunPaceTrend`（`healthMetrics/summary.ts`/`trends.ts`）仅测试调用，生产无 import；当前活跃路径是 `registry + chartSeries + aggregate + chartDisplay + healthBlocks/*`。
- **`HealthMetricRange` 3 档 vs `healthRangeSetting` 6 档并存**：旧 3 档只被孤儿 `healthUtils.ts` 和 `healthBlocks/range.ts` 用。
