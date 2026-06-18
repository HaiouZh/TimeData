---
type: evergreen
title: 待办任务
covers:
  - packages/shared/src/types.ts:Task
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/syncDomains.ts
  - packages/client/src/db/index.ts
  - packages/client/src/pages/TodoPage.tsx
  - packages/client/src/pages/todo/**
  - packages/client/src/lib/tasks.ts
  - packages/client/src/lib/tasks/**
  - packages/client/src/components/MonthCalendar.tsx
  - packages/client/src/components/Wheel.tsx
  - packages/client/src/components/ui/Sheet.tsx
  - packages/client/src/lib/useIsWideScreen.ts
  - packages/server/src/db/schema.ts
  - packages/server/src/lib/db-rows.ts
  - packages/server/src/routes/tasks.ts
  - packages/server/src/routes/agent.ts
  - packages/server/src/sync/domains.ts
  - packages/cli/src/commands/tasks.ts
last-reviewed: 2026-06-18
---

# 待办任务

> 待办域覆盖 `tasks` 表、重复规则、子任务、四分区任务池和受控 agent 状态回写。
> 它不讲同步账本机制本身；LWW、seq、force-push 见 [sync](sync.md)。

## 承上启下

- 上游：用户在 Web 待办页新增/编辑/勾选/排序任务；速记页 composer 可把文本存为普通任务；授权 agent / CLI 可通过受控 API 回写状态。
- 下游：本地 Dexie `tasks` 与 `syncLog(tableName="tasks")` 同事务写入，随后经 [sync](sync.md) 推到 server，再按 `sync_seq` 下发其他设备。
- 契约：字段 schema 见本文 §2；跨域时间、ID、SQL/Dexie 映射约定见 [data-model](data-model.md)。
- 邻居：[quick-notes](quick-notes.md) 是另一个捕捉入口；[categories-settings](categories-settings.md) 管设置页中的待办默认落点外的分类设置；[backup](backup.md) 管备份格式。

## 1. 数据流

### 1.1 Web 本地写入

`TodoPage` 读取 `listTasks()` 的分桶视图，所有 mutation 落到 `packages/client/src/lib/tasks.ts`。`addTask` / `putTask` / `persistTaskOrder` / `deleteTask` 都必须在同一个 Dexie transaction 里写业务表 `tasks` 和待同步队列 `syncLog`；同步日志失败时业务写入也回滚。

客户端写入只负责体验侧校验与本地排序，不是最终裁判。服务端收到同步变更后仍用登记簿 schema 解析并按 LWW 域写入 SQLite。

### 1.2 同步与服务端查询

客户端 push `tasks/create|update|delete`。服务端 `SERVER_SYNC_DOMAINS.tasks` 是通用 LWW 域：upsert 时把 `recurrence` / `subtasks` / `tags` 序列化为 JSON 字符串，`done` 映射为 0/1；delete 真删当前行并写 tombstone，供其他设备 pull 重放。

`GET /api/tasks` 是只读查询入口，支持 `kind=pool|recurring` 与 `done=0|1`，按 `sort_order, created_at, id` 排序。`POST /api/tasks/:id/schedule` 是受控排期写入口，会更新 task 并追加 `sync_seq`；它不是绕过同步账本的新底层写入路径。

### 1.3 Agent 状态回写

外部 agent / CLI 封装通过：

```text
POST /api/agent/tasks/:id/status { turn?, done?, note?, tags? }
```

`/api/agent/*` 使用 scoped auth，可接受 `AUTH_TOKEN` 或 `AGENT_TOKEN`。body 至少带一个字段，只允许回合状态、完成、备注子任务和 tags 这些封闭动作。服务端读取当前 task，`TaskSchema.parse` 合成下一版，构造 `tasks/update` 的 `SyncChange`，走 `applyChange()` 写 SQLite + `sync_seq`，再 `notifySyncChange(getLatestSeq())` 让前台客户端普通同步拉取。

`AGENT_TOKEN` 不授予 sync、admin、export、reset 或 force-push 权限；泄露影响面限制在任务状态回写。

## 2. Schema / 契约

### 2.1 Recurrence

```ts
type Recurrence = {
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  byWeekday?: number[];
  byMonthday?: number[];
  time?: string;
  basis: "due" | "completion";
  count?: number;
  until?: string;
};
```

- `interval` 是 1..999 的正整数。
- `byWeekday` 用 ISO 周几，1=周一、7=周日；weekly 必填。
- `byMonthday` 支持 1..31 和 `-1`（月末）；monthly 必填。
- daily 不能带 weekday/monthday；weekly 不能带 monthday；monthly 不能带 weekday。
- `count` 与 `until` 互斥；`until` 是 UTC ISO，用来表达本地某天为止。
- `basis="due"` 按计划日判断下一次；`basis="completion"` 从上次完成日往后推。

### 2.2 TaskSubtask

```ts
type TaskSubtask = {
  id: string;
  title: string;
  done: boolean;
};
```

`id` 与 `title` 都是 trim 后非空字符串。子任务没有独立表，顺序就是 `Task.subtasks` 数组顺序。

### 2.3 Task

```ts
type Task = {
  id: string;
  title: string;
  done: boolean;
  recurrence: Recurrence | null;
  lastDoneAt: string | null;
  startAt: string | null;
  scheduledAt: string | null;
  subtasks: TaskSubtask[];
  completedCount: number;
  turn: "me" | "running" | "parked" | null;
  turnAt: string | null;
  completedAt: string | null;
  tags: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
```

- `subtasks` 默认 `[]`，最多 200 个。
- `completedCount` 默认 0。
- `turn` 默认 `null`，只表达当前回合；完成真相仍是 `done`。
- `tags` 默认 `[]`，最多 50 个，每个非空且最长 64 字符。
- 所有时间字段都是 UTC ISO 字符串或 `null`。
- SQLite 表名是 `tasks`；`recurrence` / `subtasks` / `tags` 存 JSON 字符串；`done` 存 0/1。
- Dexie 表名也是 `tasks`，索引是 `id, scheduledAt, sortOrder, updatedAt`。

## 3. 关键不变量 / 坑 / 红线

- `turn` 不是完成态。同值设置会短路；非 `null` 时刷新 `turnAt`，清空时同步清空 `turnAt`。
- `tags` 是自由语义标签，只用于人工/agent 表达和 OR 过滤，不驱动自动逻辑。字段选择背景见 [ADR 0014](../adr/0014-task-tags-vs-fields.md)。
- 普通任务完成时客户端写 `done=true` 并设置 `completedAt`；取消完成会清空 `completedAt`。agent `done=true` 会把任务置完成并清空 `turn/turnAt`，但当前不补 `completedAt`，不要把所有完成路径写成等价。
- 重复任务勾选时递增 `completedCount`、写 `lastDoneAt`。未终结时会把 `subtasks[].done` 重置为 `false` 让下一轮就绪；终结性完成（count 满或 until 过）保留子任务勾选并进完成区。
- `scheduleTask` / `unscheduleTask` 拒绝重复任务。重复任务是否“今天待做”由 `isDueNow()` 按本地日序号计算。
- 四分区是读时视图：`today`、`inbox`、`scheduled`、`completed`，另有全量去重桶 `recurring` 供 AttentionQueue / TagFilterBar 使用。`scheduled` = 一次性未来排期 + 未到期重复，按下一发生日升序；`completed` 按 `completedAt` 倒序。
- 只有“今天”列允许同池拖拽重排。`persistTaskOrder()` 回填 `sortOrder/updatedAt`，并为每个变化项写 `syncLog`。
- `tasks` 不引用 `Category`、`TimeEntry` 或 `QuickNote`，不参与分类校验、时间段重叠、时长统计或速记导入导出。

## 4. 模块速查

| 关注点 | 入口 |
|---|---|
| 类型 / schema | `packages/shared/src/entitySchemas.ts`、`packages/shared/src/types.ts` |
| 客户端本地模型 | `packages/client/src/lib/tasks.ts`、`packages/client/src/lib/tasks/**` |
| 页面 | `packages/client/src/pages/TodoPage.tsx`、`packages/client/src/pages/todo/**` |
| 重复规则 UI | `RecurrencePresetSheet.tsx`、`RecurrencePresetList.tsx`、`CustomRecurrencePage.tsx`、`MonthCalendar.tsx`、`Wheel.tsx` |
| 子任务 / 行交互 | `TaskRow.tsx`、`TaskDetailSheet.tsx`、`SubtaskEditor.tsx`、`taskRowZone.ts` |
| 任务池与偏好 | `placement.ts`、`taskSort.ts`、`workbenchPrefs.ts`、`TaskColumn.tsx`、`DayGroupedList.tsx`、`ResizableSplit.tsx` |
| agent / CLI | `packages/server/src/routes/agent.ts`、`packages/cli/src/commands/tasks.ts` |
| 服务端查询 / 同步域 | `packages/server/src/routes/tasks.ts`、`packages/server/src/sync/domains.ts` |
| 代表测试 | `packages/client/src/lib/tasks*.test.ts`、`packages/client/src/pages/todo/*.test.tsx`、`packages/server/src/routes/tasks.test.ts`、`packages/server/src/routes/agent.test.ts`、`packages/server/src/sync/tasks-domain.test.ts` |

## 深水细节

待办 UI 的“窄屏/宽屏”、“swipe + 详情抽屉”、“四区折叠状态”和“重复预设门”属于产品交互细节，若后续继续增长并形成独立 covers 簇，可按 [_docs-guide](_docs-guide.md) 的毕业阈值外提。
