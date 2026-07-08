---
type: evergreen
title: 待办 · 想法重力
covers:
  - packages/client/src/lib/tasks/gravity.ts
  - packages/client/src/lib/tasks/gravityClock.ts
  - packages/client/src/lib/tasks/gravityReviewStorage.ts
  - packages/client/src/lib/settings/todoGravitySetting.ts
  - packages/client/src/pages/settings/SettingsTodoGravityPage.tsx
contracts:
  - packages/client/src/lib/settings/todoGravitySetting.ts
last-reviewed: 2026-07-08
---

# 待办 · 想法重力

> [todo](../todo.md) 的子文档。想法重力 = 收件箱**水位线 + 翻牌复查 + 水下找回**：久未动的 root inbox 任务沉入"水下"，默认视图只显示浮起部分；翻牌区随机复查水下任务，`顶一下` 增加抗沉；完整水下列表挂在 Inbox 展开链条尾部找回。
> 本文讲：水位判定、翻牌抽卡与已过目记忆、水下尾部入口、设置项、不变量。Task 字段契约（`weight`）与四分区落点见母文档。

## 承上启下

- **上游**：`TodoPage` 用 `listTasks()` 出桶后的 inbox 作为输入；用户在翻牌区/水下尾部点 `↑ 顶一下` 调 `bumpTaskWeight`（`lib/tasks.ts`）。
- **下游**：`Task.weight` 与已过目记忆（settings key）经 [sync](../sync.md) LWW 跨设备同步。
- **契约**：`Task.weight`（int，默认 0，翻牌"顶一下"累加）见 [todo](../todo.md) §2.1；settings key `todo.gravity.v1`（参数）与 `todo.gravity.review.v1`（已过目表）见本文 §2。
- **邻居**：[todo](../todo.md)（inbox 分桶、DnD）、[categories-settings/settings-catalog](../categories-settings/settings-catalog.md)（settings 键值同步机制）。

## 1. 机制

### 1.1 水位线（浮起 / 水下）

`Task.weight` 是同步字段，`updatedAt` 提供时间衰减。`TodoPage` 在 `listTasks()` 出桶后用 `splitInboxByGravity` 把 inbox 拆成 `floatingInbox` / `sunkenInbox`：久未更新（`updatedAt` 老于水位线天数）且 `weight` 不足以抗沉的 root 任务判水下（`isTaskSunken`）。水位日期在本地跨日、focus、visibility 恢复时刷新。

重力**只作用于 root inbox 展示层**：`listTasks()`、排期分桶、tag/search、DnD 域登记都不感知它。

### 1.2 翻牌复查区（`GravityReviewSection`）

today 附近的临时折叠复查面，不注册 `sortable/containerId`：

- 展开时抽 `drawM` 张水下任务、最多顶 `pickN` 张；抽卡优先久未露面，其次 `weight` 作温和 tie-breaker，再按创建时间（`pickGravityReviewBatch`）。
- `↑ 顶一下` 经 `TaskRow` 的 `extraAction` 插槽渲染，调 `bumpTaskWeight` 累加 `weight` 并写 syncLog；顶过的卡在本轮额度内即时移出并补抽，直到额度耗尽。
- **展示即标记**：`drawBatch()` 发牌后经 `onMarkSurfaced` 写已过目表，不写 Task、不刷新 `updatedAt`；另维护本会话已标记 set，防 settings 回流慢时「再翻几张」抽回刚展示过的任务。

### 1.3 已过目记忆（`todo.gravity.review.v1`）

翻牌轮换记忆走 settings key `todo.gravity.review.v1`（`Record<taskId, iso>`，LWW 同步；`useGravitySurfacedMap` / `markGravityTasksSurfaced`）。写时 merge + prune `max(90, waterlineDays*4)` 天。settings LWW 在极端并发下可能丢少量已过目标记，后果只是偶尔重复翻到，容错可接受。

### 1.4 水下找回尾部（`SunkenInboxTail`）

Inbox `DayGroupedList` 展开链条尾部的找回入口，**不是新平级模块**：

- 浮层日期组不超过 3 个时尾部直接可达；浮层为 0 但仍有水下任务时也只渲染这个尾部入口。
- 默认收起「水下 X 条」，展开后按日期分组渲染完整 `sunkenInbox`，不注册 `sortable/containerId`；`顶一下` 只 bump weight 不触发翻牌重抽。
- 搜索 / tag 过滤作用于尾部，但不把水下任务混回默认浮层。

## 2. 设置（`todo.gravity.v1`）

`lib/settings/todoGravitySetting.ts`：JSON 设置包装（parse/sanitize/default/set/use），Dexie settings LWW 同步。设置子页 `SettingsTodoGravityPage`（`/settings/todo-gravity`，「水位线与翻牌」）：

- 6 参数 autosave 调参 + 真实 inbox 水下数量预览 + 恢复默认；预览用共享 `currentGravityDate` + `splitInboxByGravity`（与 TodoPage 同一口径，helper 在 `gravityClock.ts`：`currentGravityDate` / `msUntilNextLocalDay`）。
- 关闭水位线只让预览与 TodoPage 水位线短路，数字参数仍可编辑。
- 连续 autosave 串行合并，避免快速操作互相覆盖。

## 3. 不变量

1. **展示层特性**：重力不改变任何数据落点——`listTasks()` 分桶、DnD、tag/search 不感知；翻牌区与水下尾部都不注册 DnD。
2. **展示即标记，不碰 Task**：翻牌记忆只写 settings，不写 Task 行、不刷新 `updatedAt`（否则展示本身会把任务顶回水面，机制自毁）。
3. **`weight` 只经 `bumpTaskWeight` 递增**，不建 Dexie 索引；它是 `tasks` LWW 域的普通结构化字段，不新增同步域（见 [sync](../sync.md) §0）。

## 4. 模块速查

| 入口 | 职责 |
|---|---|
| `lib/tasks/gravity.ts` | 纯函数：`isTaskSunken` / `splitInboxByGravity` / `pickGravityReviewBatch` |
| `lib/tasks/gravityClock.ts` | 共享重力日期 helper：`currentGravityDate` / `msUntilNextLocalDay` |
| `lib/tasks/gravityReviewStorage.ts` | 已过目表读写：`useGravitySurfacedMap` / `markGravityTasksSurfaced`（merge + prune） |
| `pages/todo/GravityReviewSection.tsx` | 翻牌折叠复查区（属母文档 covers 的 `pages/todo/**`，行为归本文） |
| `pages/todo/SunkenInboxTail.tsx` | 水下完整列表找回尾部（同上） |
| `lib/settings/todoGravitySetting.ts` | `todo.gravity.v1` 设置包装 |
| `pages/settings/SettingsTodoGravityPage.tsx` | 设置子页：调参 + 预览 |

测试：`lib/tasks/gravityClock.test.ts`、`pages/todo/SunkenInboxTail.test.tsx`（其余行为并入 `TodoPage.test.tsx`）。
