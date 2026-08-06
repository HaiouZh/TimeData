---
type: evergreen
title: 统计与洞察 · 待办统计
covers:
  - packages/client/src/pages/TodoStatsPage.tsx
  - packages/client/src/pages/stats/todo/**
  - packages/client/src/lib/todoStats/**
  - packages/client/src/pages/settings/SettingsTodoStatsLayoutPage.tsx
last-reviewed: 2026-08-06
---

# 统计与洞察 · 待办统计

> [统计与洞察](../stats-insights.md) 的**横切子文档**：待办统计页（`/stats/todo`）整片——页面取数、模块注册表、9 个 Section 组件、9 个纯逻辑模块的口径契约、布局设置页。
> 讲什么：`TODO_STATS_MODULES` 注册表、`stats.todo.layout.v1` 布局设置、各纯逻辑模块（`lib/todoStats/*`）的算法口径与边界特判。
> 不讲什么：时间统计与洞察引擎（见母文档 [stats-insights](../stats-insights.md)）、`tasks` 数据与服务端删除归档（见 [todo](../todo.md) / [todo/modules](../todo/modules.md)）。

## 承上启下

- **上游**：`tasks` 表全量（`db.tasks.toArray()` + `TaskSchema.safeParse` 逐行校验，失败行丢弃）；`listTasks()` 四分区桶（总览模块用）；`goals` 表（裸行直喂，消费端容错缺字段）。删除数据来自服务端 `GET /api/tasks/deleted-archive`（只读，服务端实现归 [todo/modules](../todo/modules.md)，本域 covers 不含服务端）。
- **下游**：无（终端视图，不写业务数据）。布局偏好写 `settings` 表（`stats.todo.layout.v1`），经同步跨端。
- **契约**：本域无独立 DB 表，布局设置键 `stats.todo.layout.v1`（真值见 `todoStatsModules.ts` 的 `TODO_STATS_LAYOUT_KEY`）走 `settings` 同步键值表；删除归档 `ArchiveItem` 结构是客户端消费契约，字段以服务端为准（旧快照缺字段容错为 null）。
- **邻居**：[todo](../todo.md)（`tasks` 数据源与删除归档服务端）、母文档 [stats-insights](../stats-insights.md)（时间统计；两页共用 `lib/statsLayoutSetting.ts` 泛型布局存取，各管各的 key）。

## 1. 数据流 + 模块注册表

### 1.1 路由与取数

- `/stats/todo` → `TodoStatsPage`（`components/app-shell/AppRoutes.tsx` lazy 注册）；入口在时间统计页头部（`TimeStatsPage.tsx`）。
- `/settings/todo-stats-layout` → `SettingsTodoStatsLayoutPage`（设置入口在 `SettingsPage.tsx`）。
- `TodoStatsPage` 三路 `useLiveQuery` 取数：`listTasks()` 出四分区桶、`db.tasks.toArray()` + `TaskSchema.safeParse` 出全量任务、`db.goals.toArray()` 出目标。`today = getDateString(new Date())`（按 `APP_TIME_ZONE` 的本地日）。
- `moduleContext`（`TodoStatsModuleProps`）打包 `{ today, tasks, buckets, goals }`，按 `layout.visibleModulesInOrder` 映射 `TODO_STATS_MODULES[id].component` 渲染；全隐藏时显示空态 + 「去设置启用」链接。
- 布局设置经 `useStatsLayoutForKey`（`lib/statsLayoutSetting.ts` 泛型）读写，**与时间统计页共用同一套泛型，各管各的 key**（时间统计用 `stats.layout.v1`）。

### 1.2 注册表（`pages/stats/todo/todoStatsModules.ts`）

9 个模块，`TODO_STATS_MODULES` 是 `Record<TodoStatsModuleId, TodoStatsModuleDef>`（漏注册任一 id 直接编译期报错）；顺序 = `TODO_STATS_MODULE_LIST`：

| id | title | 组件 | 依赖的纯逻辑 |
|---|---|---|---|
| overview | 总览 | TodoOverviewSection | `buildTodoOverview`（overview.ts） |
| created | 创建分布 | CreatedDistributionSection | `creationEvents` + `weeklyDistribution` |
| completed | 完成分布 | CompletedDistributionSection | `creationEvents`/`completionEvents` + `completionRate` |
| age | 存活时长分布 | AgeDistributionSection | `ageBuckets`（age.ts） |
| heatmap | 完成热力图 | CompletionHeatmapSection | `completionEvents` + `heatmapCells` |
| cycle | 周期指标 | CycleMetricsSection | `cycleMetrics`（cycle.ts） |
| rhythm | 节奏 | RhythmSection | `completionEvents` + `rhythmMatrix` |
| dimension | 维度拆解 | DimensionSection | `tagBreakdown`/`projectBreakdown`（dimension.ts） |
| deleted | 删除洞察 | DeletedInsightsSection | `deletedStats`（deletedStats.ts） |

9 个模块 `defaultVisible` 全为 true，默认按注册表顺序全显。

**布局设置**（`TODO_STATS_LAYOUT_KEY = "stats.todo.layout.v1"`，`todoStatsModules.ts` 单点定义、页面与设置页单点导入）：值结构 `{ order, hidden }`（均 `TodoStatsModuleId[]`）；默认 `order` = 注册表顺序、`hidden` = `defaultVisible=false` 的模块（当前全 true，故默认空）。`sanitizeStatsLayout` 读取时兜底：剔除未知 id、去重、缺失模块按注册表顺序追加、损坏 JSON 回退默认。设置页支持显隐开关、dnd-kit 拖拽排序、重置默认布局。

## 2. 各纯逻辑模块的口径契约（`lib/todoStats/*`）

### 2.1 events.ts —— 事件序列（五个模块共用）

- `completionEvents`：完成事件 = `completedAt !== null && recurrence === null` 的行。**重复模板行（含耗尽）排除**防双计；**不排除 occurrence 行**；只看 `completedAt`，不看 `done`。
- `creationEvents`：创建事件 = `ruleId === null && !isOccurrenceChildId(id)` 的行。occurrence 物化行不算创建（`createdAt` 是系统物化时刻而非立 flag 时刻）；occurrence 子任务克隆行（id 形如 `{occurrenceId}:child:{templateChildId}`）也不算。
- `countByDay`/`countByWeek`：按 `APP_TIME_ZONE` 本地日分桶（`getDateString`），周按周一（`startOfWeek`）。

### 2.2 overview.ts —— 总览数字墙

- `total = tasks.length`；`doneTotal` = `completionEvents` 长度（排除重复模板行）；`open = total − doneTotal`。
- `byBucket`：today/inbox/scheduled 直数桶长；projects = 各项目组 tasks 之和。
- `recurringRules` = `recurrence !== null && parentId === null` 的根重复模板行数，**不过滤 done**（耗尽的模板行仍计）。
- `overdue` = **两路并集**：① today 桶里 `placementForTask` 判 `pool==="today" && overdue` 的行（重复/occurrence 追平项自带标志）；② 一次性过期任务补计——未完成、`recurrence/ruleId/parentId` 全 null、`scheduledAt!==null` 且本地日 `< today`。这类任务按 placement.ts 的设计回流 inbox、不带 overdue 标志，须单独补计。
- `noSchedule` = 未完成根任务里 `scheduledAt === null` 的行（直数，不等同 inbox.length——inbox 还混有回流的一次性过期任务）。

### 2.3 age.ts —— 存活时长分布

- 候选 = `creationEvents` 里 `!done && recurrence === null` 的行（未完成的一次性任务；重复模板永不 done，单列会失真）。
- 年龄 = `(now − createdAt) / DAY_MS`（毫秒差算天数，非日历日差）。
- 桶 `[<7天, 7-30天, 30-90天, >90天]`，**左闭右开**：恰 7/30/90 天整归入更大桶（`ageDays < 7` / `< 30` / `< 90`）。
- `oldest` = 全局最老 5 条（`createdAt` 升序前 `OLDEST_LIMIT=5`），**每个桶携带同一份全局列表**。

### 2.4 cycle.ts —— 周期指标

- 周转只对一次性任务（`ruleId === null`）计算（occurrence 行的 `createdAt` 是物化时刻，排除）；周转 = `(completedAt − createdAt) / DAY_MS` 天。
- 桶 `[当天, 1-3天, 4-7天, 8-30天, >30天]`，**右闭、边界归小桶**（与 age 方向相反）：`days < 1` 归当天，`<= 3 / <= 7 / <= 30` 依次归小桶。
- `medianTurnaroundDays`：奇取中间、偶取中位平均；无样本 → `null`。
- `avgCompletedPerDay = 完成事件数 / (today − 首个完成事件日 + 1)`，分母含首尾日历天；无事件 → 0。
- streak：连续有 ≥1 完成事件的**本地日历天**集合。`currentStreak` 从今天回数，**今天尚无完成则从昨天起算**（今天不打断）；`longestStreak` 从每段连击的起点数，避免重复计数。

### 2.5 distribution.ts —— 近 12 周分布

- `weeklyDistribution`：近 N 周（**含今日所在周**）周一起序列、升序；事件按 `startOfWeek(getDateString(...))` 归桶；**空周补 0**；窗口外事件静默丢弃。
- `completionRate`：创建/完成两列按周对齐，返回原始分子分母；**除法与「—」文案交给组件**（`CompletedDistributionSection` 本周 `created > 0` 才算百分比）。
- 两分布模块的 `WEEKS = 12`（组件内常量）。

### 2.6 heatmap.ts —— 完成热力图

- `HEATMAP_DAYS = 365`（组件内常量）。格子从 `startOfWeek(today − (days−1))` 铺到 today：**首列对齐窗口首日所在周的周一，窗口不足一周也铺满整周**（days=1 时从本周一铺到 today）。
- 每天一格，count = 当天完成数（按 `APP_TIME_ZONE` 日归属）；窗口外事件忽略。
- `level`：count=0 → 0；max<4 时 count 即 level（封顶 4）；否则按 max 四等分 `min(4, ceil(count/(max/4)))`（max=0 走 count=0 分支，不会除零）。

### 2.7 rhythm.ts —— 节奏矩阵

- 7（周一..周日）× 4 时段（0-6/6-12/12-18/18-24）矩阵，**按本地时刻归属**：`toLocalDateTimeString` 取本地时分 → `weekdayIndex` 定行（0=周一）、`floor(hour/6)` 定列（封顶 3）；显式禁止 UTC 裸切割。
- 与 `getDateString` 同源走 `APP_TIME_ZONE`。无日期范围过滤（窗口外/未来时间戳同样计数）。

### 2.8 dimension.ts —— 维度拆解

- `tagBreakdown`：**一任务多标签各计一次**；无标签任务归入「未打标签」桶；按 `open+done` 降序取前 `TAG_TOP_N=10`。
- `projectBreakdown`：只认 `status==="active" && kind==="project"` 的 goal，遍历 `members`（`kind==="task"` 项）计数；成员查不到则跳过；按传入 goals 顺序输出，不排序。
- **本模块不做事件排除**：直接遍历全部任务，模板/occurrence/子任务克隆行都计入（与其余模块走 events 排除不同）。

### 2.9 deletedStats.ts —— 删除洞察

- 数据源：`GET /api/tasks/deleted-archive`（服务端归档表只读）；UI 注明「删除数据自 2026-07-12 归档上线起算」。
- `ArchiveItem = { taskId, deletedAt, deleteReason, snapshot }`；`snapshot` 为 Task 最小子集，`createdAt` 可空（旧快照容错）。
- `total`/`byWeek`/`byReason` 数**全部行**：`byWeek` 按 `deletedAt` 本地周（周一起）聚合、空周补 0；`byReason` 按 `deleteReason` 分组。
- `survivalBuckets`：只数 `snapshot.createdAt` 非空的行；存活 = `deletedAt − createdAt`；桶 `[<7天, 7-30天, 30-90天, >90天]` **左闭右开**（恰 7/30/90 归大桶）；**另排除 `snapshot.ruleId` 非空的 occurrence 行**——其 createdAt 是物化时刻，会把存活时长压向 <7天桶。
- `deletedAfterDone`：`snapshot.completedAt` 非空且 `recurrence` 空的行——**不查 done**；排除模板行（补加重复后 done 重置但历史 completedAt 不清空，陈旧 completedAt 不代表作为重复任务完成过）。
- 坏行（snapshot 缺失 / createdAt null）：只进 total 与 byReason。

## 3. 关键不变量 / 坑 / 红线

1. **完成与创建的排除域刻意不对称**：`completionEvents` 排除重复模板行但计入 occurrence 行；`creationEvents` 排除 occurrence 物化行与子任务克隆行（id 含 `:child:`）。两者不是互为补集。
2. **桶边界方向随函数而变**：age/survival 桶左闭右开（恰 7 天归「7-30天」）；cycle 周转桶右闭（恰 7 天归「4-7天」）。写断言先查所属函数。
3. **时区一律 `APP_TIME_ZONE`（`@timedata/shared` 常量，当前 "Asia/Shanghai"）**：日切分走 `getDateString`/`startOfWeek`/`toLocalDateTimeString`，rhythm.ts 显式禁止 UTC 裸切割；跨 UTC 日界的 23:00Z 归本地次日。
4. **overview 的 overdue 是双路并集**：带标志的桶内行 + 回流 inbox 的一次性过期任务（不带标志），漏补第二路就少计。
5. **deletedStats 按快照字段自建排除**：坏行只进 total/byReason；occurrence 行（ruleId 非空）不进存活桶；模板行（recurrence 非空）不计 deletedAfterDone；deletedAfterDone 只凭 completedAt 非空，不查 done。
6. **dimension 不做任何事件排除**：模板/occurrence 行在标签与项目维度里都计入，与其余模块口径不同。
7. **currentStreak 今天不打断**：今天尚无完成事件时从昨天起算；`avgCompletedPerDay` 分母含首尾日历天。
8. **deleted 是唯一不接 moduleContext 的模块**：`DeletedInsightsSection` 不消费 props、自行 fetch 服务端；其余 8 个模块全部本地计算。
9. **布局设置读取时按注册表 sanitize**：剔除未知 id、去重、补缺失、损坏回退——防注册表变动后旧设置崩溃。

## 4. 模块速查（代码入口 + 测试）

### 4.1 客户端

| 入口 | 职责 |
|---|---|
| `pages/TodoStatsPage.tsx` | 页面壳：三路 `useLiveQuery` 取数 + `moduleContext` + 按注册表渲染 + 空态 |
| `pages/stats/todo/todoStatsModules.ts` / `types.ts` | `TODO_STATS_MODULES` 注册表 + `TODO_STATS_MODULE_LIST` + `TODO_STATS_LAYOUT_KEY` / `TodoStatsModuleId`、`TodoStatsModuleProps` |
| `pages/stats/todo/modules/*Section.tsx` | 9 个 Section UI（组件→模块映射见 §1.2 表） |
| `lib/todoStats/*.ts` | 纯逻辑（口径契约见 §2） |
| `pages/settings/SettingsTodoStatsLayoutPage.tsx` | 布局设置页：显隐开关 / 拖拽排序 / 重置 |
| `lib/statsLayoutSetting.ts` | 泛型布局存取 + sanitize（`useStatsLayoutForKey`，与时间统计共用） |

### 4.2 测试

**页面/组件**：`pages/TodoStatsPage.test.tsx`、`pages/stats/todo/todoStatsModules.test.ts`、`pages/stats/todo/modules/DeletedInsightsSection.test.tsx`、`pages/settings/SettingsTodoStatsLayoutPage.test.tsx`（9 个 Section 仅 `DeletedInsightsSection` 有组件测试，其余靠纯逻辑测试兜）
**纯逻辑**：`lib/todoStats/{age,cycle,deletedStats,dimension,distribution,events,heatmap,overview,rhythm}.test.ts`（9 个全有）
