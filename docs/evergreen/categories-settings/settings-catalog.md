---
type: evergreen
title: 设置 · 同步键值表
covers:
  - packages/client/src/lib/settings/index.ts
  - packages/client/src/lib/settings/navVisibleTabsSetting.ts
  - packages/client/src/lib/settings/punchCategorySetting.ts
  - packages/client/src/lib/sleepCategorySetting.ts
  - packages/client/src/pages/settings/SettingsNavPage.tsx
last-reviewed: 2026-06-21
---

# 设置 · 同步键值表

> [categories-settings](../categories-settings.md) 的**子文档**：`settings` 跨设备键值表怎么读写、有哪些 key、各 key 归哪个消费域。
> 不讲：Category 实体（见 [categories-settings](../categories-settings.md)）、各消费域如何使用某个设置（见对应域文档）。

## 承上启下

- **上游**：用户在各设置页编辑偏好；首启 legacy 迁移把旧 localStorage 值搬进 Dexie `settings`。
- **下游**：各 key 被多域消费（见下表）；mutation 经 `syncLog(tableName="settings")` → [sync](../sync.md)（**LWW**）。
- **契约**：`Setting = {key, value, updatedAt}`，`settingToRow` + 通用 LWW 注册在 `server/src/sync/domains.ts`（covers 归 [categories-settings](../categories-settings.md)）。
- **邻居**：[categories-settings](../categories-settings.md)（主题）、及下表各消费域。

## 1. 持久化机制（`lib/settings/index.ts`）

通用读写 `getSetting` / `setSetting` / `useSetting`：

- `setSetting` 事务表 = `settings, syncLog`。
- `value=null` 时删除并写 `settings/delete`（仅当已存在）；否则 `put` 并按是否已存在写 `settings/update` 或 `settings/create`。
- settings 域走**通用 LWW**（`server/src/sync/domains.ts`），`conflictPolicy:"lww"`、`countsInStatus:false`（不进 `/api/sync/status` 业务计数）。
- 各具体设置用「包装文件」封装 key + 序列化 + sanitize，不直接散调 `getSetting`。

## 2. settings key 全表

| key | 值结构 | 包装文件 | 消费域 |
|---|---|---|---|
| `sleep.categoryId` | 顶层分类 ID 或 null | `lib/sleepCategorySetting.ts` | [stats-insights](../stats-insights.md)（睡眠口径） |
| `punch.categoryId.v1` | 子分类 ID 或 null（须未归档子分类） | `lib/settings/punchCategorySetting.ts` | [timeline](../timeline.md)（打点） |
| `nav.visibleTabs.v1` | JSON 数组 ⊆ `[/quick-notes,/,/todo,/tracks,/stats/time,/stats/health]`；旧 `/stats`→`/stats/time` | `lib/settings/navVisibleTabsSetting.ts` | 底部导航 |
| `health.range.presets` | 逗号串 `7,30,90,180,365,all` | `lib/settings/healthRangeSetting.ts`（covers 归 [health/charts](../health/charts.md)） | [health](../health.md) |
| `stats.layout.v1` | JSON `{order, hidden}` | `lib/statsLayoutSetting.ts`（covers 归 [stats-insights](../stats-insights.md)） | [stats-insights](../stats-insights.md) |
| `stats.module.trend.v1` | JSON 趋势窗口/图表类型 | `lib/statsModuleTrendSetting.ts`（covers 归 [stats-insights](../stats-insights.md)） | [stats-insights](../stats-insights.md) |
| `todo.defaultDestination.v1` | `"today"\|"inbox"`，默认 today | `lib/settings/todoDefaultDestinationSetting.ts`（covers 归 [todo](../todo.md)） | [todo](../todo.md) |
| `track.actionTags.v1` | JSON 字符串数组(trim/去重);未配置→种子 `[等我,待决策,卡住,agent在做]`,显式 `"[]"`→空 | `lib/settings/trackActionTagsSetting.ts`(covers 归 [tracks](../tracks.md)) | [tracks](../tracks.md)(状态标签建议表 + 最新步统计面板) |

> 本子文档 covers 只含通用基础设施 `lib/settings/index.ts` + 三个本域归属的包装：`navVisibleTabsSetting.ts`、`punchCategorySetting.ts`、`sleepCategorySetting.ts`（在 `lib/` 非 `lib/settings/` 目录）。其余包装（health-range / stats-layout / stats-trend / todo-dest）的 covers 归各自消费域文档，本表只导航。

## 3. 关键不变量 / 坑 / 红线

1. **settings 是跨域共享键值表**：一个 key 一个 value 一个 updatedAt；不同 key 归不同消费域，**covers 按 key 包装文件分摊到各域**，不要把 `lib/settings/**` 整目录塞进一份文档。
2. **`punch.categoryId.v1` 要求有效未归档子分类**：未配置或分类失效时打点不写 `time_entries`（动作在 [timeline](../timeline.md)）。
3. **`sleep.categoryId` 当前 UI 只允许选一级分类**：只定义统计睡眠口径（[stats-insights](../stats-insights.md) 消费）。
4. **`nav.visibleTabs.v1` 旧值归一化**：读取时 `/stats` → `/stats/time`，`/settings` 固定保留。
5. **LWW 后写赢**：settings 无 manual 冲突，跨设备后写覆盖；改设置语义时注意多设备并发覆盖。

## 4. 模块速查

| 入口 | 职责 |
|---|---|
| `lib/settings/index.ts` | `getSetting`/`setSetting`/`useSetting` + syncLog 同事务 |
| `lib/settings/navVisibleTabsSetting.ts` | 底部导航可见入口设置 + sanitize |
| `lib/settings/punchCategorySetting.ts` | 打点分类 ID 设置（`punch.categoryId.v1`） |
| `lib/sleepCategorySetting.ts` | 睡眠分类 ID 设置（`sleep.categoryId`，旧路径在 `lib/`） |
| `pages/settings/SettingsNavPage.tsx` | 底部导航开关页 |

**测试**：`lib/settings/{index,navVisibleTabsSetting,punchCategorySetting}.test.ts`、`lib/sleepCategorySetting.test.ts`、`pages/settings/SettingsNavPage.test.tsx`。

## 深水细节

- **`SettingsInsightsPage` 是跨域宿主页**（待办默认落点 / 打点分类 / 睡眠分类都在它里编辑），其页面 covers 归 [stats-insights](../stats-insights.md)；本子文档只拥有 `punchCategorySetting`/`sleepCategorySetting`/`navVisibleTabsSetting` 数据层。
