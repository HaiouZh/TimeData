---
type: evergreen
title: 统计与洞察
covers:
  - packages/client/src/pages/StatsPage.tsx
  - packages/client/src/pages/TimeStatsPage.tsx
  - packages/client/src/pages/stats/InsightCharts.tsx
  - packages/client/src/pages/stats/modules/**
  - packages/client/src/lib/stats.ts
  - packages/client/src/lib/insights/**
  - packages/client/src/lib/statsLayoutSetting.ts
  - packages/client/src/lib/statsModuleTrendSetting.ts
  - packages/client/src/pages/settings/SettingsInsightsPage.tsx
  - packages/client/src/pages/settings/SettingsStatsLayoutPage.tsx
last-reviewed: 2026-06-18
---

# 统计与洞察

> 时间统计页 `/stats/time`：按周期/日期聚合 `time_entries`，产出总览/作息/异常/趋势/结构五模块洞察。
> 讲什么：STATS_MODULES 注册表、周期区间与“只统计到今天”、baseline 90 天、布局/趋势设置、insights 引擎各模块契约。
> 不讲什么：健康统计页（见 [health](health.md)）、时间段数据流（见 [timeline](timeline.md)）、分类管理（见 [categories-settings](categories-settings.md)）、同步（见 [sync](sync.md)）。

## 承上启下

- **上游**：`time_entries`（来自 [timeline](timeline.md)）经 `db.timeEntries.where("endTime").above(...)` 查询；`sleep.categoryId` 设置（来自 [categories-settings/settings-catalog](categories-settings/settings-catalog.md) 的 `sleepCategorySetting`）决定睡眠口径。
- **下游**：无（终端视图，不写业务数据）。布局/趋势偏好写入 `settings` 表（`stats.layout.v1` / `stats.module.trend.v1`），经同步跨端。
- **契约**：本域无独立 DB 表，全部走 `settings` 同步键值表。跨域约定见 [data-model](data-model.md)。
- **邻居**：[timeline](timeline.md)（时间段数据源）、[health](health.md)（`/stats/health` 平级页面，无文件交叠）、[categories-settings](categories-settings.md)（睡眠分类设置 + 布局/趋势设置页宿主）。

## 1. 数据流（本域端到端）

### 1.1 路由

- `/stats` → `StatsPage` 仅 `<Navigate to="/stats/time" replace />`。
- `/stats/time` → `TimeStatsPage`。
- `/settings/stats-layout` → `SettingsStatsLayoutPage`（模块显隐/上下移/重置）。
- `/settings/insights` → `SettingsInsightsPage`（**历史路由名保留，实为“杂项”页**：含待办默认落点（[todo](todo.md)）+ 打点分类（[categories-settings](categories-settings.md)）+ 睡眠分类（本域消费）三块，仅睡眠分类属本域）。

### 1.2 TimeStatsPage 周期/日期/总时长上下文 + 共享取数（`TimeStatsPage.tsx`）

- 周期状态：`mode`（day/week/month）、`anchor`、`today`（60s 轮询 + window focus + visibilitychange 刷新）。
- 周期区间：`buildStatsRangeForDate(mode, anchor)`（`lib/stats.ts`）算 `fromDate/toDate/startUtc/endUtc`。
- **当前周/月只统计到今天**：`isLatestPeriod(mode, anchor, today)`（`lib/stats.ts`）阻止向后翻；最新周期且 `toDate > today` 时 `effectiveToDate=today` 并重算 `endUtc`，`rangeClampedToToday` 标记“截至 {date}”。
- baseline 窗口：`baselineFrom = today-(baselineWindowDays-1)` = today-89（`lib/insights/constants.ts` `baselineWindowDays=90`），覆盖 [today-89, today] 共 90 天。
- **baseline 只在可见模块声明需要时取**：`needBaseline = layout.visibleModulesInOrder.some(id => STATS_MODULES[id].needs?.baseline)`；`baselineEntries` 用 `useLiveQuery` 按 `endTime > baselineFrom` 且 `startTime < today+1` 过滤。
- 取数优化：若 `needBaseline && periodWithinBaseline` → `entries = baselineEntries` 按周期裁剪；否则 `periodFallback` 独立查周期区间。
- **`memoOverview` 在头部“已记录”处总是算一次**（即使 overview 隐藏，用于头部总时长复用缓存）；其余 4 模块的 memo 仅在组件内调用，隐藏则不算。
- `moduleContext`（`StatsModuleProps`）打包 mode/today/effectiveRange/baselineFrom/entries/baselineEntries/categories/parentCategories/parentNameById/sleepCategoryId；内容区按 `layout.visibleModulesInOrder` 映射 `STATS_MODULES[id].component`，全隐藏显示空态 + 跳转设置。

### 1.3 STATS_MODULES 注册表（`pages/stats/modules/statsModules.ts`）

5 个模块（顺序 = `STATS_MODULE_LIST`）：

| id | title | defaultVisible | needs | component |
|---|---|---|---|---|
| overview | 总览 | true | — | OverviewSection |
| routine | 作息 | true | `{ sleepCategory: true }` | RoutineSection |
| anomalies | 异常与空挡 | true | `{ baseline: true }` | AnomaliesSection |
| trend | 趋势变化 | true | `{ baseline: true }` | TrendSection |
| structure | 结构诊断 | true | `{ baseline: true }` | StructureSection |

> `needs.sleepCategory` 声明但 `TimeStatsPage` 只读 `needs?.baseline`；`sleepCategoryId` 经 `useSleepCategoryId()` 总是取并传给所有模块。`needs.sleepCategory` 当前仅信息性，不驱动取数。

## 2. Schema / 契约（全部走 `settings` 同步键值表）

### 2.1 `stats.layout.v1`（`lib/statsLayoutSetting.ts`）

```ts
{ order: StatsModuleId[]; hidden: StatsModuleId[] }
```

默认 `order` = 全部模块按注册表顺序，`hidden` = `defaultVisible=false` 的模块（当前全 true，故默认 `hidden=[]`）。`sanitizeStatsLayout`：剔除未知 id、去重、缺失已注册模块按注册表顺序追加、`defaultVisible=false` 新模块自动补 hidden、损坏 JSON 回退默认。`useStatsLayout` 返回 `{order, hidden:Set, visibleModulesInOrder, setLayout, reset}`。

### 2.2 `stats.module.trend.v1`（`lib/statsModuleTrendSetting.ts`）

```ts
{ window: TrendWindowSpec; chart: "line" | "area" }
```

`TrendWindowSpec`（`lib/insights/trends.ts`）三态：`{kind:"preset",days}` / `{kind:"customDays",days}` / `{kind:"customRange",from,to}`。默认 `{window:{kind:"preset",days:7},chart:"line"}`；`days` 在 `resolveTrendWindow` clamp 到 [1,365]。

### 2.3 `sleep.categoryId`（跨域共享设置）

值为父分类 id 或 null。**不在 `stats.*` 命名空间**，归 [categories-settings/settings-catalog](categories-settings/settings-catalog.md) covers，本域只消费。未指定时覆盖率按全天估算，睡眠时段默认 23:00~07:00。

### 2.4 lib/insights 各模块契约

| 模块 | 入 → 出 | 关键点 |
|---|---|---|
| `cache.ts` | 指纹 `${length}:${maxUpdatedAt}` + 单槽 memo + 日桶缓存 | 5 模块 memo 导出；`getCachedDailyRollups` 按 `${from}~${to}`+指纹 Map 缓存；跨 React 卸载存活 |
| `dailyRollup.ts` | `(entries,categories,from,to)` → `DailyRollup[]` | 本地日桶预聚合；跨午夜按本地午夜裁剪；防御上限 400 天；二分定桶 |
| `overview.ts` | `OverviewInput` → `OverviewInsights` | totalRecordedHours/coverageRawPct/coverageDisplayPct(clamp≤100)/parents；有睡眠分类时 `awakeMin=periodMin-sleepMin`，否则不扣睡眠 |
| `routine.ts` | `RoutineInput` → `RoutineInsights` | 主睡眠段 `durationMin≥180` 才作锚点；样本≥7 按中位入睡/起床外扩 60min 得 `sleepWindow(source:"samples")`，否则回退 23:00~07:00(`source:"fallback"`)；规律度 stdev≤60 stable / ≥120 variable |
| `baseline.ts` | `baselineEntries` → 阈值 | `overlongThresholdMin=max(P95,180)`；`longGapThresholdMin` 清醒空档样本≥10 取 P90 否则 90 |
| `anomalies.ts` | `DetectAnomaliesInput` → `Anomaly[]` | 5 型 overlong/overnight/sleepTimeActivity/longGap/unrecordedDay；阈值来自 baseline；**只对当前周期 `inRange(date)` 产出**；`sleepTimeActivity` 仅以 startTime 判定 |
| `trends.ts` | `TrendInput` → `TrendResult` | 本期 + 等长上一窗口；上期数据天数≥3 才 `prevComparable`；上期 <30min 不算百分比改判 new；TopN=3 |
| `structure.ts` | `BuildStructureInput` → `StructureResult` | 深度/碎片会话池排除睡眠；熵按整体父结构（含睡眠）；`deepThreshold=max(P70,20)`、`fragmentThreshold=P30`；占比失衡 \|z\|≥1.5 且基线≥7 天才报 |
| `sessions.ts` | → `InsightSession[]` | `resolveParentId`（子→父，父→自身，未知→"unknown"）；同父相邻间隙≤3min 合并 |
| `constants.ts` | — | 全部可调常量集中，注释含校准编号 C1~C5/T1~T5/D2~D5 |

时间投入堆叠面积图 Y 轴固定 `[0,24]`、ticks `[0,6,12,18,24]`（`TrendSection.tsx`，仅 `chart==="area"` 传入）；折线图不固定 domain。

## 3. 关键不变量 / 坑 / 红线

1. **当前周/月只统计到今天**：`isLatestPeriod` 阻止向后翻 + `effectiveToDate` clamp。
2. **异常检测在当前周期产出，用近 90 天基线定阈值**：`anomalies.ts` 用 baselineEntries 构建 `buildInsightBaseline`，`inRange` 限定产出范围。
3. **隐藏模块组件不挂载**；routine/anomalies/trend/structure 隐藏时不计算，**overview 因头部总时长复用而始终计算**。
4. **baseline 只在可见模块声明 `needs.baseline` 时取**；`needs.sleepCategory` 声明但未被 TimeStatsPage 消费。
5. **布局设置读取时按注册表 sanitize**：防注册表变动后旧设置崩溃（剔除未知 id、补缺失、去重、损坏回退）。
6. **趋势窗口完全独立于页面周期**：`TrendSection` 用自己的 `trendWindowSpec + today` 解析，不随 mode/anchor；窗口超 baseline 时独立 `useLiveQuery` 兜底。
7. **`stats/health/**` 属 health 域，本域不收**：`HealthStatsPage`（`/stats/health`）与 `TimeStatsPage`（`/stats/time`）平级、共享 `stats/` 前缀但实现独立、无文件交叠。
8. **时间一律 UTC ISO，本地日桶按 `APP_TIME_ZONE` 切分**：`dailyRollup.ts` 用 `localDateTimeToUtc`；`routine.ts`/`anomalies.ts` 用 `Intl.DateTimeFormat` 带 `APP_TIME_ZONE`。
9. **会话合并容差 3min、噪声会话下限 1min**（`lib/insights/constants.ts`）。

## 4. 模块速查（代码入口 + 路由 + 测试）

### 4.1 客户端

| 入口 | 职责 |
|---|---|
| `pages/StatsPage.tsx` | 旧 `/stats` 重定向到 `/stats/time` |
| `pages/TimeStatsPage.tsx` | 周期/日期/总时长上下文 + 共享取数（baseline/period）+ 按注册表渲染可见模块 + 头部总时长 |
| `pages/stats/modules/statsModules.ts` / `types.ts` | `STATS_MODULES` 注册表 + `STATS_MODULE_LIST` / 模块类型 |
| `pages/stats/modules/{Overview,Routine,Anomalies,Trend,Structure}Section.tsx` | 五模块 UI |
| `pages/stats/modules/ui.tsx` | 共享 `SectionPanel`/`MetricCard`/`metricToneClass` |
| `pages/stats/InsightCharts.tsx` | `TrendChart`(line/area) + `CategoryCompositionBars` + `CategoryDonut` |
| `lib/stats.ts` | `buildStatsRangeForDate`/`shiftStatsAnchor`/`isLatestPeriod`/`formatStatsRangeLabel`/`summarizeEntriesByParentCategory` |
| `lib/insights/{cache,constants,types,dailyRollup,sessions,overview,routine,baseline,anomalies,trends,structure}.ts` | 见 §2.4 |
| `lib/statsLayoutSetting.ts` / `lib/statsModuleTrendSetting.ts` | 布局 / 趋势设置存取 + sanitize |
| `pages/settings/SettingsInsightsPage.tsx` | “杂项”设置页（跨域宿主）：待办默认落点 + 打点分类 + 睡眠分类（仅睡眠属本域） |
| `pages/settings/SettingsStatsLayoutPage.tsx` | 统计模块显隐/上移下移/重置 |

### 4.2 测试

**页面/组件**：`pages/{StatsPage,TimeStatsPage}.test.tsx`、`pages/stats/InsightCharts.test.tsx`、`pages/stats/modules/{statsModules,OverviewSection,RoutineSection,AnomaliesSection,TrendSection,StructureSection,ui}.test.{ts,tsx}`、`pages/settings/{SettingsStatsLayoutPage,SettingsInsightsPage}.test.tsx`
**纯逻辑**：`lib/stats.test.ts`、`lib/statsLayoutSetting.test.ts`、`lib/statsModuleTrendSetting.test.ts`、`lib/insights/{cache,dailyRollup,sessions,overview,routine,baseline,anomalies,trends,structure}.test.ts`

## 深水细节

- **`hooks/useInView.ts` 是孤儿**（grep 仅自身测试引用，生产零引用）：为统计图表延迟挂载准备的 IntersectionObserver hook，**当前未接线**。**不进 covers**，待清理或接线。
- **`SettingsInsightsPage` 命名误导**：文件名/路由名 `insights`，实际 title=“杂项”。三 section 分属三域（待办落点→[todo](todo.md)、打点分类→[categories-settings](categories-settings.md)、睡眠分类→本域消费）。本域 covers 含它因睡眠口径属统计，但编辑该页也影响 todo/categories-settings，需一并复查。
- **`summarizeEntriesByParentCategory`（`lib/stats.ts`）存在但 `TimeStatsPage` 未用**——旧实现遗留，当前用 `memoOverview` 替代。
