---
type: evergreen
title: 分类与设置
covers:
  - packages/shared/src/types.ts:Category
  - packages/shared/src/entitySchemas.ts
  - packages/client/src/pages/settings/SettingsCategoriesPage.tsx
  - packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx
  - packages/client/src/components/SortableCategoryItem.tsx
  - packages/client/src/hooks/useCategories.ts
  - packages/client/src/lib/categorySort.ts
  - packages/client/src/lib/categoryColors.ts
  - packages/client/src/lib/categoryTree.ts
  - packages/client/src/lib/sleepCategorySetting.ts
  - packages/client/src/lib/settings/punchCategorySetting.ts
  - packages/server/src/routes/categories.ts
  - packages/server/src/sync/domains.ts
last-reviewed: 2026-06-18
---

# 分类与设置

> 本文覆盖分类字段 schema、分类管理页、排序/颜色/归档/删除，以及依赖分类的 sleep/punch 设置边界。
> 它不拥有所有设置页：服务器、数据恢复、Garmin、健康范围、统计布局等仍归各自域或横切文档。

## 承上启下

- 上游：用户在分类设置页新增、重命名、排序、改色、归档或删除分类；杂项设置选择睡眠父分类或打点子分类。
- 下游：分类被 [timeline](timeline.md) 的 `time_entries` 引用，被 [stats-insights](stats-insights.md) 用作统计维度；分类自身通过 `categories` 同步域跨设备同步。
- 契约：字段 schema 见本文 §2；跨域时间、ID 和同步信封见 [data-model](data-model.md)。
- 邻居：[timeline](timeline.md) 负责分类引用与时间记录校验；[stats-insights](stats-insights.md) 使用睡眠分类口径；[quick-notes](quick-notes.md) 只提供打点入口，不拥有分类。

## 1. 数据流

分类管理页入口在设置首页 `/settings/categories`，详情页是 `/settings/categories/:id`。所有客户端分类写入集中在 `useCategories.ts`：

- 新增：trim 名称，拒绝空名和同层级未归档重名，`sortOrder` 取未归档 sibling 数量，写 `categories` + `syncLog(create)` 同事务。
- 重命名：只改 `name/updatedAt`，不改 `id`，不迁移 `TimeEntry.categoryId`；同时同步更新本地 `autoBackups` 里同 ID 分类的可见字段。
- 排序：只接受当前 sibling scope 的完整 id 列表，更新变化项 `sortOrder/updatedAt` 并为每项写 `categories/update`。
- 颜色：只允许一级分类改色，子分类跟随父级；一键配色只作用于未归档一级分类。
- 归档：软隐藏，写 `isArchived=true` 与 `categories/update`。
- 直接删除：删除目标分类、后代分类和关联 `timeEntries`，为被删 entry 写 `time_entries/delete`，为分类写 `categories/delete`，同事务完成。

服务端 `GET /api/categories` 返回未归档分类只读列表。真正写入来自 `/api/sync/push` 的 `categories` 域钩子：拒绝自引用和第三级，delete 级联后代分类与关联 entries，并写 tombstone + `sync_seq`。

同步 settings 是独立键值表。本文只记录依赖分类的两个设置边界：`sleep.categoryId` 保存睡眠父分类 id；`punch.categoryId.v1` 保存有效子分类 id，打点前会确认分类存在、未归档且有未归档父级。

## 2. Schema / 契约

```ts
type Category = {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  icon: string | null;
  sortOrder: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};
```

- `id` / `name` 是 trim 后非空字符串。
- `parentId` 为非空字符串或 `null`；TimeData 当前最多两级。
- `color` 是 `#RRGGBB`，客户端会归一为大写。
- `icon` 为非空字符串或 `null`。
- `sortOrder` 是有限整数，只在同一个 `parentId` scope 内比较。
- `createdAt` / `updatedAt` 是严格 UTC ISO。
- SQLite 表是 `categories(id, name, parent_id, color, icon, sort_order, is_archived, created_at, updated_at)`。
- Dexie 索引是 `categories: "id, parentId, sortOrder"`。

## 3. 关键不变量 / 坑 / 红线

- 分类最多两级；服务端拒绝自引用与第三级。未来若支持第三级，CLI path、统计页、备份校验都要一起改。
- 同层级未归档分类不得重名；新增与重命名都在 hook 层检查。
- 排序只在同一 `parentId` scope 内比较。一级分类只能和一级分类重排，子分类只能在同父下重排。
- 子分类颜色跟随父分类；用户只直接调整一级分类颜色。
- 归档保留分类行，删除是真删除且级联关联记录。服务端分类 delete 会写分类和 entry tombstone。
- `sleep.categoryId` 只定义统计睡眠口径，当前 UI 只允许选择一级分类。
- `punch.categoryId.v1` 只允许有效子分类；未配置或分类失效时打点不写 `time_entries`。
- 不要把 `packages/client/src/lib/settings/**` 全部归本文；nav、health range、todo 默认落点、统计布局分别归它们自己的域。

## 4. 模块速查

| 关注点 | 入口 |
|---|---|
| schema | `packages/shared/src/entitySchemas.ts`、`packages/shared/src/types.ts` |
| 分类页面 | `SettingsCategoriesPage.tsx`、`SettingsCategoryDetailPage.tsx`、`SortableCategoryItem.tsx` |
| 分类逻辑 | `useCategories.ts`、`categorySort.ts`、`categoryColors.ts`、`categoryTree.ts` |
| 分类设置边界 | `sleepCategorySetting.ts`、`settings/punchCategorySetting.ts`；实际打点写入见 [timeline](timeline.md) |
| 服务端 | `packages/server/src/routes/categories.ts`、`packages/server/src/sync/domains.ts` |
| 代表测试 | `useCategories.test.ts`、`categorySort.test.ts`、`categoryColors.test.ts`、`categoryTree.test.ts`、`SettingsCategoriesPage.test.tsx`、`SettingsCategoryDetailPage.test.tsx`、`sleepCategorySetting.test.ts`、`punchCategorySetting.test.ts`、`routes/sync.test.ts` |

## 深水细节

默认分类预设定义在 `packages/shared/src/constants.ts`，仍作为跨域出厂数据契约保留在 [data-model](data-model.md)。若后续分类预设文档落地，应由 data-model 与本文共同链接，而不是把预设复制到两个地方。
