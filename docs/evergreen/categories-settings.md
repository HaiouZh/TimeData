---
type: evergreen
title: 分类与设置
covers:
  - packages/shared/src/types.ts:Category
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/constants.ts
  - packages/client/src/pages/settings/SettingsCategoriesPage.tsx
  - packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx
  - packages/client/src/components/SortableCategoryItem.tsx
  - packages/client/src/hooks/useCategories.ts
  - packages/client/src/lib/categorySort.ts
  - packages/client/src/lib/categoryColors.ts
  - packages/client/src/lib/categoryTree.ts
  - packages/server/src/routes/categories.ts
  - packages/server/src/sync/domains.ts
last-reviewed: 2026-06-25
---

<!-- 复核 2026-06-23（目标层 Phase 1.1）：Goal.members 修正触及 shared schema / sync domains covers；分类与 settings 字段、manual 同步语义、播种规则均不变。 -->
<!-- 复核 2026-06-25（请求审计一期）：shared types 新增 AdminRequestLog* 只读导出，未改变 Category / Setting schema、同步语义或设置 key 契约。 -->

# 分类与设置

> 分类域的**主题文档**：`categories` 两级分类实体（增删改排序归档颜色）。
> 本文讲：Category 字段契约、两级约束、客户端 mutation、服务端自定义 apply（manual + 级联 + 不校验重名）、DEFAULT_CATEGORIES 与播种。
> `settings` 同步键值表（sleep/punch/nav/layout… 全表 + 持久化机制）见子文档 [categories-settings/settings-catalog](categories-settings/settings-catalog.md)。
> 不讲：同步管线（见 [sync](sync.md)）、统计如何消费分类（见 [stats-insights](stats-insights.md)）、打点动作本身（见 [timeline](timeline.md)）。

## 承上启下

- **上游**：用户在设置页编辑分类；首次启动两端用同一份 `DEFAULT_CATEGORIES` 播种。
- **下游**：`categories` 被 [timeline](timeline.md) 的 `time_entries.categoryId` 引用、被 [stats-insights](stats-insights.md) 用作统计维度；分类 mutation 经 `syncLog(tableName="categories")` → [sync](sync.md)（**manual** 冲突策略）。
- **契约**：`Category` 字段 schema 见本文 §2，定义在 `entitySchemas.ts:CategorySchema`；`DEFAULT_CATEGORIES` 在 `constants.ts`；跨域约定见 [data-model](data-model.md)。
- **邻居**：[timeline](timeline.md)（分类引用 + 打点）、[stats-insights](stats-insights.md)（睡眠分类口径）、[tracks](tracks.md)（轨道当前只用 refs/tags，不新增分类或 settings 语义）、[categories-settings/settings-catalog](categories-settings/settings-catalog.md)（settings 键值表）。

## 1. 数据流（本域端到端，跨包）

### 1.1 分类管理 mutations（`hooks/useCategories.ts`）

每个 mutation 在 `db.transaction("rw", ...)` 内同时改 Dexie `categories` + 写 `syncLog`；rename/color/archive/reorder 还同步 patch 本地 `autoBackups` 里同 ID 分类的可见字段（name/color/icon/sortOrder/isArchived/updatedAt）：

| 操作 | syncLog action | 是否动 autoBackups | 关键 |
|---|---|---|---|
| `addCategory(name, parentId, color)` | `categories/create` | **否**（新增不进历史快照） | `sortOrder=未归档兄弟数`，`icon:null`；client 拒同层级未归档重名 |
| `renameCategory(id, name)` | `categories/update` | 是 | 只改 `name/updatedAt`，不改 `id`，不迁移 `TimeEntry.categoryId` |
| `updateCategoryColor(id, color)` | `categories/update` | 是 | **子分类抛错**（颜色属一级分类） |
| `applyCategoryPalette(paletteId)` | 每个变色一级一条 | 是 | 只作用未归档一级分类，循环应用预设色板 |
| `archiveCategory(id)` | `categories/update` | 是 | `isArchived=true`，行保留、列表过滤隐藏 |
| `deleteCategory(id)` | `categories/delete` + `time_entries/delete` | **否** | 级联删后代分类 + 关联 TimeEntry；事务后确认 impact |
| `persistCategoryOrder(parentId, orderedIds)` | 每个变 sortOrder 项一条 | 是 | `orderedIds` 必须等于当前同 parentId 未归档兄弟集合，否则 return |

- **排序安全闸**：`persistCategoryOrder` 校验 `orderedIds` 必须等于当前同 parentId 未归档兄弟集合，长度/成员不一致直接 return，只对实际变化项写 syncLog。
- **删除事务后确认**：`requireResolvedCategoryDeleteImpact(impact)` 在事务闭包外，异常时 impact=null → 抛错，避免返回不完整 `{childCount, entryCount}`；`pendingDeleteImpact` 模块级缓存（预读→删除复用，用后即清）。
- **拖拽排序（dnd-kit）**：一级在 `SettingsCategoriesPage`（`reorderCategories(null, …)`），子级在 `SettingsCategoryDetailPage`（`reorderCategories(parentId, …)`）；一级与子级**绝不混排**，手柄在 `SortableCategoryItem`。

### 1.2 服务端 apply（自定义，不走通用 LWW）

`applyCategoryChange` / `validateCategoryChange`（`server/src/sync/domains.ts`）：

- **upsert**：先校验自引用（`parentId===id` → `invalid_shape`）、父分类存在、父 `parentId===null`（拒第三级）。**仅 upsert 校验，delete 不校验层级**。**服务端不校验重名**——重名唯一性只是 client 体验约束，server 接受同层级重名 upsert（“服务端是权威”原则的一个例外）。`updated_at` 由服务器分配。
- **delete**：服务器**自行级联**——从 `recordId` BFS 收集所有后代（`categoryTree.ts:collectCategoryTreeIds`），逆序删其下 `time_entries`（tombstone + `recordSeq`）再删分类（tombstone + `recordSeq`），返回 `overriddenRecordIds = cascadedEntryIds`。
- `categories` 域 `conflictPolicy:"manual"`、`countsInStatus:true`、`upsertPriority:10`/`deletePriority:50`（保证分类 upsert 先于 entries 外键依赖，categories delete 最后级联安全）。
- `GET /api/categories`（`routes/categories.ts`）返回未归档分类只读列表；真正写入来自 `/api/sync/push` 的域钩子。

### 1.3 首次启动播种（两端同源）

`createDefaultCategories(timestamp?)`（`constants.ts`）遍历 `DEFAULT_CATEGORIES` 生成扁平 `Category[]`，父子共享同一 timestamp。server `initializeDatabase()` 检测 `categories` 为空时 `insertDefaultCategories`（`db/reset.ts`）；client `seedDefaultCategories()`（`db/index.ts`）同理。legacy 迁移 `migrateLocalSettingsToDexie` 把 localStorage 旧 `sleepCategoryId` 一次性搬到 Dexie `settings`。

## 2. Schema / 契约（字段级）

### 2.1 `Category`（`entitySchemas.ts:CategorySchema`）

```ts
{
  id: string;            // NonEmptyTrimmed
  name: string;          // NonEmptyTrimmed
  parentId: string | null;  // 非空字符串或 null（null=顶层）；schema 不 trim
  color: string;         // #RRGGBB（HexColorSchema）
  icon: string | null;   // 非空字符串或 null
  sortOrder: number;     // int finite（允许负数）
  isArchived: boolean;
  createdAt: string;     // 严格 UTC ISO
  updatedAt: string;     // 严格 UTC ISO（服务器分配）
}
```

SQL `categories`（`db/schema.ts`）：`parent_id` FK → categories(id)，`is_archived` 0/1 ↔ boolean（`Boolean(row.is_archived)`），索引 `idx_categories_parent`。Dexie 索引 `"id, parentId, sortOrder"`。映射 `rowToCategory`（`lib/db-rows.ts`）。

### 2.2 DEFAULT_CATEGORIES（`constants.ts`）

五个顶层、共 14 个子分类（替代了 data-model 旧 `./domain/categories-preset.md` 死链，预设表落本文）：

| 顶层 id | 名称 | 颜色 | 子分类 |
|---|---|---|---|
| `cat-sleep` | 睡眠 | `#708090` | 睡眠、小睡 |
| `cat-survival` | 生存 | `#50C878` | 吃喝、洗漱、其他 |
| `cat-invest` | 投资 | `#7B68EE` | 读书、背单词、记录复盘、跑步、锻炼、冥想 |
| `cat-leisure` | 享乐 | `#FFB347` | 娱乐 |
| `cat-ops` | 运转 | `#4A90D9` | 通勤、家务 |

子分类 `color` 继承父，`sortOrder` = 父下序号，`icon:null`。

### 2.3 settings 键值表

`Setting = {key, value, updatedAt}`（`entitySchemas.ts:SettingSchema`），SQL `settings(key PK, value NOT NULL, updated_at)`，走通用 LWW（`countsInStatus:false`）。**全 key 表、各包装文件与持久化机制见子文档 [categories-settings/settings-catalog](categories-settings/settings-catalog.md)**。

## 3. 关键不变量 / 坑 / 红线

1. **两级硬约束不在 schema**：schema 层 `parentId` 只是非空字符串或 null；两级靠 `validateCategoryChange`（仅 upsert）+ UI/CLI 假设。加第三级需改：CLI path 解析、统计页父子占比、备份校验、`validateCategoryChange`。
2. **`sortOrder` 作用域**：只在同一 `parentId` 下比较；`compareCategoryOrder` 三级 tiebreak（sortOrder → name → id）保证稳定全序。
3. **名称可改、身份不变**：重命名只改 `name/updatedAt`，**不迁移 `TimeEntry.categoryId`**，历史记录按当前 name 展示。
4. **颜色属于一级分类**：`updateCategoryColor` 子分类抛错；`getCategoryColor` 子分类回溯父色；一键配色只遍历未归档一级分类循环应用色板（classic/morandi/macaron 各 14 色）。
5. **归档 ≠ 删除**：归档软删（行保留、`isArchived=true`、列表隐藏）；直接删除真删 + 级联 + tombstone。
6. **重名是 client 体验约束、server 不校验**：`addCategory`/`renameCategory` 在 client 拒同层级未归档重名；`validateCategoryChange` 不查重名，server 接受同层级重名 upsert。
7. **categories delete 的双重 seq 冗余**：client 发 N 条 `categories/delete` + M 条 `time_entries/delete`，server 处理父级 delete 时又自行级联 + recordSeq；tombstone/delete 幂等，但 seq 有重复写入。
8. **`useCategories` 缓存**：`categoryById`/`childrenByParentId` Map；`getCategoryPath`（“父名 · 子名”，未找到“未知”）/`getCategoryColor`（未找到 `#808080`）/`getChildren` O(1)。
9. **`punch.ts` 不归本域**：打点动作 `punchNow` 写 `time_entries`（归 [timeline](timeline.md)）；本域/子文档只拥有其分类设置 `punchCategorySetting.ts`。
10. **目标层不改变 Category 语义**：Goal 新增 shared schema / sync 登记簿分支会命中本域 covers，但分类两级树、排序、归档、级联删除都不变；底部导航新增 `/goals` 的 settings key 取值见 [settings-catalog](categories-settings/settings-catalog.md)。

## 4. 模块速查（代码入口 + 路由 + 测试）

| 关注点 | 入口 |
|---|---|
| schema / 预设 | `shared/entitySchemas.ts`（Category）、`shared/constants.ts`（DEFAULT_CATEGORIES） |
| 分类页面 | `pages/settings/{SettingsCategoriesPage,SettingsCategoryDetailPage}.tsx`、`components/SortableCategoryItem.tsx` |
| 分类逻辑 | `hooks/useCategories.ts`、`lib/{categorySort,categoryColors,categoryTree}.ts` |
| 服务端 | `routes/categories.ts`（只读列表）、`sync/domains.ts`（`validateCategoryChange`/`applyCategoryChange`，manual + 级联） |
| settings 键值表 | → [categories-settings/settings-catalog](categories-settings/settings-catalog.md) |
| 代表测试 | `lib/{categorySort,categoryColors,categoryTree}.test.ts`、`hooks/useCategories.test.ts`、`pages/settings/{SettingsCategoriesPage,SettingsCategoryDetailPage}.test.tsx`、`server/sync/{resolver,validation}.test.ts`、`routes/sync.test.ts`、`db/{index,db}.test.ts` |

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [categories-settings/settings-catalog](categories-settings/settings-catalog.md) | `settings` 表持久化机制、全 key 表（sleep/punch/nav/layout/trend/health-range/todo-dest）、nav/punch/sleep 包装、`SettingsNavPage` |

## 深水细节

- **`SettingsHealthRangePage`/`SettingsStatsLayoutPage` 不归本域**：前者→[health](health.md)，后者→[stats-insights](stats-insights.md)。
- **`SettingsInsightsPage` 是跨域宿主**（显示名“记录偏好”，历史路由 `/settings/insights`），归 [stats-insights](stats-insights.md) covers；本域的 `punchCategorySetting` 在该页有编辑 UI，但页面本身不属本域。
