---
type: evergreen
title: 统计与洞察
covers:
  - packages/client/src/pages/StatsPage.tsx
  - packages/client/src/pages/TimeStatsPage.tsx
  - packages/client/src/pages/stats/InsightCharts.tsx
  - packages/client/src/pages/stats/modules/**
  - packages/client/src/hooks/useInView.ts
  - packages/client/src/lib/stats.ts
  - packages/client/src/lib/insights/**
  - packages/client/src/lib/statsLayoutSetting.ts
  - packages/client/src/lib/statsModuleTrendSetting.ts
  - packages/client/src/lib/sleepCategorySetting.ts
  - packages/client/src/pages/settings/SettingsInsightsPage.tsx
  - packages/client/src/pages/settings/SettingsStatsLayoutPage.tsx
last-reviewed: 2026-06-18
---

# 统计与洞察

> 统计与洞察域覆盖 `/stats/time`、时间投入聚合、洞察模块、模块布局设置和睡眠口径设置。
> `/stats/health` 属于 [health](health.md)，不要用 `pages/stats/**` 宽泛 covers 吞掉健康页。

## 承上启下

- 上游：Dexie `timeEntries` 与 `categories`，以及同步 settings 表里的布局、趋势窗口和睡眠分类设置。
- 下游：统计页是终端视图，只写 UI 设置，不写 `timeEntries`、`categories` 或健康原始数据。
- 契约：`TimeEntry` 字段 schema 见 [timeline](timeline.md)；分类 schema 见 [categories-settings](categories-settings.md)；settings 键值约定见 [data-model](data-model.md)。
- 邻居：[health](health.md) 拥有健康原始数据和 `/stats/health`；[timeline](timeline.md) 与本文共享本地日期边界和 `[start, end)` 裁剪口径。

## 1. 数据流

`/stats` 只由 `StatsPage.tsx` 重定向到 `/stats/time`。`TimeStatsPage.tsx` 负责周期模式（日/周/月）、锚点日期、今日刷新、统计窗口、近 90 天 baseline 查询、分类上下文和模块上下文组装。

统计窗口统一用本地日期边界转 UTC，记录按：

```text
entry.startTime < rangeEnd && entry.endTime > rangeStart
```

找出交集，并只累计落在窗口内的可见时长。当前周/月如果窗口尾部超过今天，会把 `effectiveRange.toDate` 截到今天，避免未来日期拉低覆盖率或制造未记录日。

`STATS_MODULES` 注册表决定模块列表、默认可见性和是否需要 baseline。`useStatsLayout()` 读取 `stats.layout.v1` 后 sanitize，页面只渲染 `visibleModulesInOrder`。`settings/index.ts` 的 `setSetting()` 在同一 Dexie transaction 内写 `settings` 与 `syncLog(tableName="settings")`，所以布局、趋势配置和睡眠分类会跨设备同步。

## 2. Schema / 契约

本文不拥有新的业务表；它拥有以下 settings key 的行为契约：

| key | 入口 | 语义 |
|---|---|---|
| `stats.layout.v1` | `statsLayoutSetting.ts` | 模块顺序与隐藏列表；读取时剔除未知 id、去重、补齐新增模块 |
| `stats.module.trend.v1` | `statsModuleTrendSetting.ts` | 趋势模块最后使用的窗口和图表类型 |
| `sleep.categoryId` | `sleepCategorySetting.ts` | 睡眠父分类口径，用于覆盖率、作息与睡眠窗口推断 |

新增统计模块必须同步更新 `StatsModuleId`、`STATS_MODULE_IDS`、`STATS_MODULES`、布局 sanitize 测试和设置页展示。

## 3. 关键功能

- `overview`：计算本周期总记录时长、睡眠扣除后的覆盖率、父分类汇总、父到子构成和环形图数据。未配置睡眠分类时覆盖率按全天估算并标注未扣除睡眠。
- `routine`：用睡眠父分类识别睡眠样本；跨天睡眠按醒来的本地日期归属；低于 3h 的睡眠段不作为主睡眠锚点；样本不足时回退 23:00~07:00。
- `anomalies`：只在当前统计周期产出异常，类型包括超长记录、跨午夜、睡眠时段活动、长空挡、未记录日。阈值来自 baseline，长空挡样本不足时回退固定 90min。
- `trend`：窗口支持 7/30/90 天、自定义天数、自定义区间；上一窗口是等长紧邻前移。趋势图支持折线和堆叠面积，堆叠面积 Y 轴固定 0..24h。
- `structure`：计算深度块、碎片化、父分类切换/活跃小时、香农熵和占比失衡。
- `InsightCharts.tsx`：集中放 Recharts 图表与 CSS 构成条，包括 `TrendChart`、`CategoryDonut`、`CategoryCompositionBars`。
- `cache.ts` / `dailyRollup.ts`：按 entries/categories 的数量与最大 `updatedAt` 做指纹缓存；跨日记录拆到各本地日，单日时长不超过 1440 分钟。

## 4. 关键不变量 / 坑 / 红线

- 当前周/月只统计到今天，不让未来日期影响覆盖率、趋势或异常。
- hidden modules 不挂载、不计算；`needBaseline` 只看可见模块的 `needs.baseline`。
- 布局设置必须 sanitize，不信任 settings 原始 JSON。
- 统计/洞察是只读呈现域，只允许写统计 UI 设置。
- `useInView.ts` 当前保留 hook 与测试，stats 模块没有实际调用；不要把它描述成当前图表懒挂载机制。
- `sleep.categoryId` 只定义统计睡眠口径，不等于分类管理。分类字段 schema 与 CRUD 见 [categories-settings](categories-settings.md)。

## 5. 模块速查

| 关注点 | 入口 |
|---|---|
| 路由入口 | `packages/client/src/pages/StatsPage.tsx`、`packages/client/src/pages/TimeStatsPage.tsx` |
| 模块注册 / UI | `packages/client/src/pages/stats/modules/statsModules.ts`、`types.ts`、`ui.tsx` |
| 模块组件 | `OverviewSection.tsx`、`RoutineSection.tsx`、`AnomaliesSection.tsx`、`TrendSection.tsx`、`StructureSection.tsx` |
| 图表 | `packages/client/src/pages/stats/InsightCharts.tsx` |
| 纯计算 | `packages/client/src/lib/stats.ts`、`packages/client/src/lib/insights/**` |
| 设置 | `statsLayoutSetting.ts`、`statsModuleTrendSetting.ts`、`sleepCategorySetting.ts`、`SettingsInsightsPage.tsx`、`SettingsStatsLayoutPage.tsx` |
| 代表测试 | `TimeStatsPage.test.tsx`、`StatsPage.test.tsx`、`pages/stats/modules/*.test.tsx`、`lib/insights/*.test.ts`、`statsLayoutSetting.test.ts`、`statsModuleTrendSetting.test.ts` |

## 深水细节

洞察模块是最可能继续增长的区域。若某个模块形成独立算法、独立设置和独立 covers 簇，再按 [_docs-guide](_docs-guide.md) 的毕业阈值外提。
