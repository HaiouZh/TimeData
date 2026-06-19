---
type: evergreen
title: 待办任务
covers:
  - packages/shared/src/types.ts:Task
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/taskCompletion.ts
  - packages/shared/src/taskDates.ts
  - packages/shared/src/syncDomains.ts
  - packages/client/src/db/index.ts
  - packages/client/src/pages/TodoPage.tsx
  - packages/client/src/pages/todo/**
  - packages/client/src/lib/tasks.ts
  - packages/client/src/lib/tasks/placement.ts
  - packages/client/src/lib/tasks/taskSort.ts
  - packages/client/src/lib/tasks/taskRowZone.ts
  - packages/client/src/lib/tasks/workbenchPrefs.ts
  - packages/client/src/lib/tasks/inboxGrouping.ts
  - packages/client/src/lib/tasks/turnTags.ts
  - packages/client/src/lib/tasks/subtasks.ts
  - packages/client/src/lib/tasks/taskTimeLabel.ts
  - packages/client/src/lib/useIsCoarsePointer.ts
  - packages/client/src/lib/settings/todoDefaultDestinationSetting.ts
  - packages/server/src/db/schema.ts
  - packages/server/src/lib/db-rows.ts
  - packages/server/src/routes/tasks.ts
  - packages/server/src/routes/agent.ts
  - packages/server/src/sync/domains.ts
  - packages/cli/src/commands/tasks.ts
last-reviewed: 2026-06-19
---

# 待办任务

> 待办域的**主题文档**：`tasks` 表（轻量任务池 + 重复待办），跨端同步，不引用分类/时间记录/速记，不参与时长统计。
> 本文讲：Task/TaskSubtask 字段契约、四分区落点、三条写入通道、turn 回合轴、tags、agent/CLI 回写、关键不变量。
> 重复规则引擎（Recurrence schema、spawn、终止条件、预设门）见子文档 [todo/recurrence](todo/recurrence.md)。
> 不讲：同步账本机制（见 [sync](sync.md)）、备份（见 [backup](backup.md)）、CLI 命令清单（见 [cli](cli.md)）。

## 承上启下

- **上游**：用户在 Web `TodoPage` 新增/编辑/勾选/排序；速记页 composer 「存待办」调 `addTask`；授权 agent / CLI 经 `POST /api/agent/tasks/:id/status` 回写状态；CLI 经 `POST /api/tasks/:id/schedule` 排期。
- **下游**：本地 Dexie `tasks` 与 `syncLog(tableName="tasks")` 同事务写 → [sync](sync.md) 推送 → 服务端通用 LWW 域 + `sync_seq` → 其他设备按 seq 拉取。force-push 里 `tasks` 是核心同步表之一（见 [backup](backup.md)）。
- **契约**：`Task` / `TaskSubtask` 字段 schema 见本文 §2；`Recurrence` 见 [todo/recurrence](todo/recurrence.md)；跨域约定见 [data-model](data-model.md)；`tags` 不驱动自动逻辑（见 [ADR 0014](../adr/0014-task-tags-vs-fields.md)）。
- **邻居**：[quick-notes](quick-notes.md)（另一捕捉入口）、[sync](sync.md)（LWW 域 + 登记簿）、[cli](cli.md)（`tasks` / `task-*` 命令）。

## 1. 数据流（本域端到端，跨包）

### 1.1 Web 端写入

```text
用户操作 → TodoPage / TaskDetailSheet
        → lib/tasks.ts: addTask/updateTask/toggleTaskDone/scheduleTask/
           unscheduleTask/setTaskTurn/setTaskTags/updateSubtasks/deleteTask/persistTaskOrder
        → putTask(): db.transaction("rw", db.tasks, db.syncLog) 内
           db.tasks.put(next) + recordSyncLog("tasks", id, action, ts)
        → syncAfterWrite() 触发常规同步
        → POST /api/sync/push → server 通用 LWW 域（无自定义 apply）
           → taskToRow 写 SQLite tasks + 服务器分配 updated_at + recordSeq
        → sync_seq 记账 → notifySyncChange → 其他设备 SSE pull
```

所有本地写入（含 `persistTaskOrder` 批量重排）都在同一个 Dexie transaction 内同时写 `tasks` 与 `syncLog`；同步日志失败时业务写入回滚。`updated_at` 由服务器记账时分配，设备时钟漂移不影响同步正确性。客户端校验只为体验，服务端用登记簿 schema 重新解析并按 LWW 写入。

### 1.2 agent / CLI 回写任务状态（封闭动作集合）

```text
agent / CLI (task-running/task-handback/task-park/task-done/task-tag)
        → POST /api/agent/tasks/:id/status { turn?, done?, note?, tags? }
        → scopedAuthMiddleware（AUTH_TOKEN 或 AGENT_TOKEN，仅 /api/agent/* 生效）
        → routes/agent.ts: statusSchema 严格校验（至少一个字段）
        → 读当前 task，按封闭动作构造 next：
            · turn        → turn + turnAt(now 或 null)
            · done=true   → 经 shared completeTask：非重复就地完成(done+completedAt+清回合)；
                            重复非终结衍生已完成 occurrence + 推进模板；重复终结就地转化模板
            · done=false  → done=false 【不清 completedAt】
            · note        → subtasks 追加 { id, title, done:false }
            · tags        → 整体替换 tags
        → TaskSchema.parse(next) 再校验 → db.transaction([applyChange(occurrence) 若有] + applyChange(next))
        → notifySyncChange(getLatestSeq()) → 前台 SSE pull
```

`AGENT_TOKEN` 只在 `/api/agent/*` 生效，泄露影响面限于任务回合/完成/备注/tags，不授予 sync、force-push、admin、export、reset。CLI 的 `task-*` 是该受控 API 的简化封装。

### 1.3 只读查询 + 排期写端点（第三条写入通道）

- `GET /api/tasks?kind=pool|recurring&done=0|1`（`routes/tasks.ts`）：严格 querySchema，`ORDER BY sort_order, created_at, id`，`rowToTask` 映射后按 kind/done 过滤；受 `AUTH_TOKEN` 保护。
- `POST /api/tasks/:id/schedule { scheduledDate: "YYYY-MM-DD" | null }`（`routes/tasks.ts`）：CLI `task-schedule`/`task-unschedule` 调用，受 `AUTH_TOKEN` 保护；重复任务 409 `TASK_RECURRING_USE_RULE`。
  - **红线**：这条端点**直接 `UPDATE tasks SET scheduled_at, updated_at` + `recordSeq`，不走 `applyChange`/LWW 域**——即它**绕过了 LWW 的 schema 校验/冲突路径**。对比 agent 端点反而走 `applyChange`。这是 tasks 的第三条 server 写入通道（受控、AUTH_TOKEN、server 权威写），改 tasks 写入逻辑时三条通道都要照顾。

## 2. Schema / 契约（字段级）

### 2.1 `Task`（`entitySchemas.ts:TaskSchema`）

```ts
{
  id: string;                   // NonEmptyTrimmed
  title: string;                // 保存前 trim，拒空
  done: boolean;
  recurrence: Recurrence | null; // 见 todo/recurrence
  lastDoneAt: string | null;    // UTC ISO 或 null
  startAt: string | null;
  scheduledAt: string | null;
  subtasks: TaskSubtask[];      // 默认 []，max 200
  completedCount: number;       // 默认 0，int ≥0
  turn: "me" | "running" | "parked" | null;  // 默认 null
  turnAt: string | null;        // 进入当前回合的 UTC ISO
  completedAt: string | null;   // UTC ISO 或 null
  tags: string[];               // 默认 []，每项 NonEmptyTrimmed ≤64，max 50
  sortOrder: number;            // int finite
  createdAt: string;            // 严格 UTC ISO（带毫秒+Z）
  updatedAt: string;            // 严格 UTC ISO（服务器分配）
}
```

时间字段一律 `UtcIsoStringSchema`：正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$` 且 `new Date(v).toISOString()===v`。

### 2.2 `TaskSubtask`（`entitySchemas.ts:TaskSubtaskSchema`）

```ts
{ id: string; title: string; done: boolean }  // 单层不嵌套，id/title 均 NonEmptyTrimmed
```

子任务没有独立表，顺序就是 `Task.subtasks` 数组顺序，最多 200 个。

### 2.3 SQL `tasks` ↔ JS 映射（`server/src/db/schema.ts`）

| SQL 列 | JS 字段 | 存储 |
|---|---|---|
| done | done | 0/1 ↔ boolean |
| recurrence / subtasks / tags | 同名 | JSON 字符串（recurrence 可 NULL） |
| last_done_at / start_at / scheduled_at / turn_at / completed_at | lastDoneAt / startAt / scheduledAt / turnAt / completedAt | UTC ISO 或 NULL |
| completed_count / sort_order | completedCount / sortOrder | 整数 |
| turn | turn | "me"/"running"/"parked" 或 NULL |
| created_at / updated_at | createdAt / updatedAt | UTC ISO（updated_at 服务器分配） |

映射：`rowToTask`（`lib/db-rows.ts`）、`taskToRow`（`sync/domains.ts`，不写 `updated_at`）。启动时幂等 `ALTER TABLE` 补列。Dexie `tasks` 索引 `"id, scheduledAt, sortOrder, updatedAt"`（`client/src/db/index.ts`）。

### 2.4 同步域登记（`syncDomains.ts`）

`tasks` 域：`conflictPolicy:"lww"`、`countsInStatus:false`、upsert/deletePriority 45。服务端走通用 LWW（`sync/domains.ts`），无自定义 `validate`/`apply`/`crossValidate`，delete 写 tombstone。

## 3. 关键不变量 / 坑 / 红线

1. **完成统一走 shared 纯函数 `completeTask`（`shared/src/taskCompletion.ts`）**：非重复任务就地完成（`done=true` + `completedAt=now` + 清 `turn/turnAt`），取消完成（仅客户端 `toggleTaskDone` 翻回）清 `completedAt=null`；重复任务**非终结**完成衍生一条独立已完成快照 `Task`（`recurrence=null`/`done=true`/`completedAt=now`/标题·tags·完成时子任务快照/新 id），模板自身 `done` 保持 `false` 并推进（`completedCount+1`、`lastDoneAt=max(now, 应发生日)`、`subtasks[].done` 全部重置、清 `turn/turnAt`）；**终结**完成（count 满 / until 过）模板就地转化为最终完成记录（`recurrence=null`/`done=true`/写 `completedAt`，保留原 id）。落点唯一判据仍是 `done`（`placement.ts`）。重复分支细节见 [todo/recurrence](todo/recurrence.md) §3。
2. **完成统一清 `turn/turnAt`**：`completeTask` 在所有完成分支（非重复 / 重复推进 / 重复终结）都把 `turn/turnAt` 置空，客户端 `toggleTaskDone` 与 agent `done=true` 共用它而一致（旧版客户端完成不清回合的不对称已消除）。注意"取消完成"（客户端 reopen）与 agent `done=false` 不经过 `completeTask`，不触碰 `turn`。
3. **"取消完成"两端仍不对称**：agent `done=true` 现在经 `completeTask` 写 `completedAt`（与客户端一致，旧版 agent 不写的问题已修）；但 agent `done=false` 仅置 `done=false`、**不清 `completedAt`**，而客户端 reopen 会清 `completedAt=null`。撤销完成的语义两端不一致，改前先确认。
4. **schedule 端点绕过 applyChange**（见 §1.3）：tasks 有三条 server 写通道（sync push 的 LWW apply、agent status 的 applyChange、schedule 的直写+recordSeq），机制不同。
5. **四分区是读时视图**：`today` / `inbox` / `scheduled` / `completed`，另有全量去重桶 `recurring` 供 `AttentionQueue`/`TagFilterBar`。`scheduled` = 一次性未来排期 + 未到期重复，按下一发生日升序；`completed` 收纳普通完成任务、重复衍生的已完成快照与终结模板（均带 `completedAt`），按 `completedAt` 倒序、**无日期过滤**（“最近 N 天”是 `DayGroupedList` 显示侧渐进展示）。
6. **只有“今天”列允许同池拖拽重排**：`persistTaskOrder`（`tasks.ts`）在 Dexie transaction 内回填现有 `sortOrder` 槽位、更新 `updatedAt`、为每个变化项写 `syncLog`。`reorderedTaskSortOrders`（`taskSort.ts`）取池内现有 sortOrder 作槽位，长度/成员不一致时安全返回 `[]`。
7. **`tags` 自由标签不驱动自动逻辑**（[ADR 0014](../adr/0014-task-tags-vs-fields.md)）：只供人/agent 语义标记 + OR 过滤（`TagFilterBar`，`TaskRow` 最多 3 chip）。需要代码可靠动作的维度应毕业为结构化字段。
8. **`subtasks` 单层内嵌**：不升格为独立任务、不嵌套，子任务勾选不联动父 `done`/`completedAt`。`useSubtaskDraft`：结构性变化即时 commit，纯文字变化 blur/卸载时 flush。
9. **`tasks` 不引用其他域**：SQL 无外键，不参与分类校验/时间段重叠/时长统计/速记导入导出。
10. **`AttentionQueue` running 段计时器**：me/running/parked 三段；running 段渲染简化行 + “已跑 X 分”（60s interval），**不**用 `TaskRow`；me/parked 段用 `TaskRow`。

## 4. 模块速查

### 4.1 客户端

| 入口 | 职责 |
|---|---|
| `pages/TodoPage.tsx` | 顶层编排：`useLiveQuery(listTasks)` 取桶、窄屏堆叠/宽屏 `ResizableSplit`、挂 `AttentionQueue`/`TagFilterBar`/`TodoComposer`/`TaskDetailSheet` |
| `pages/todo/TaskRow.tsx` | 扁平双行任务行：复选框、`rowClickZone` 派发 expand/open、meta 第二行、dnd 拖柄、内联子任务、桌面（细指针）行尾 overlay 动作（排进今天 / 回收件箱 / 删除，由 `useIsCoarsePointer` 门控） |
| `pages/todo/{TaskColumn,TaskList,SortableTaskRow}.tsx` | 列容器 / `SwipeableList`+可选 `DndContext`（`threshold=0.3` / `maxSwipe=0.5` IOS 半程，桌面 `blockSwipe`）/ dnd-kit 包装 |
| `pages/todo/TaskDetailSheet.tsx` | 底部抽屉：子任务、标题、tag、turn SegmentedControl、删除、重复预设 overlay |
| `pages/todo/{SubtaskEditor,SubtaskRow,SortableSubtaskRow,useSubtaskDraft}.*` | 子任务编辑器 + 草稿 hook |
| `pages/todo/{DayGroupedList,AttentionQueue,TagFilterBar,TodoComposer,ResizableSplit,CollapsibleSection}.tsx` | 分组列表 / 注意力栈 / tag 筛选 / 新增 / 双栏 / 折叠 |
| `lib/tasks.ts` | 核心 CRUD + `listTasks`/`putTask`；`toggleTaskDone` 委托 shared `completeTask`，衍生 occurrence 时同事务写 occurrence + 模板 |
| `lib/tasks/{placement,taskSort,taskRowZone,taskTimeLabel,inboxGrouping,workbenchPrefs,turnTags,subtasks}.ts` | 落点 / 排序 / 点击分区 / 时间标签 / 收件箱+完成分组 / 折叠态+双栏比例 / turn+tag / 子任务工具 |
| `lib/settings/todoDefaultDestinationSetting.ts` | composer 默认目标（`todo.defaultDestination.v1`，Dexie 同步） |
| 重复规则 | → [todo/recurrence](todo/recurrence.md) |

> 跨包：完成纯计算 `shared/src/taskCompletion.ts`（`completeTask`，client `toggleTaskDone`、server agent `done=true`、CLI `task-done` 共用）+ 日期助手 `shared/src/taskDates.ts`（`localDateOf`/`normalizeScheduledDate`）；重复引擎 `shared/src/recurrence.ts` 见 [recurrence](todo/recurrence.md)。

### 4.2 服务端 / CLI

| 入口 | 职责 |
|---|---|
| `routes/tasks.ts` | `GET /`（只读查询）+ `POST /:id/schedule`（排期直写，重复 409，**不走 applyChange**） |
| `routes/agent.ts` | `POST /tasks/:id/status`（封闭动作，走 `applyChange` + `notifySyncChange`；`done=true` 经 `completeTask` 衍生/转化，occurrence 与模板各一条 `applyChange`） |
| `sync/domains.ts` | `tasks` 通用 LWW 注册 + `taskToRow`/`readTaskRecord` |
| `db/schema.ts` / `lib/db-rows.ts` | 建表/列迁移 + `rowToTask` |
| `cli/src/commands/tasks.ts` | `tasks` / `task-*` 命令（server API 封装） |

### 4.3 测试

**client**：`pages/TodoPage.test.tsx`、`pages/todo/{TaskRow,TaskColumn,TaskDetailSheet,DayGroupedList,AttentionQueue,TagFilterBar,ResizableSplit,TodoComposer,SubtaskEditor,SubtaskRow,useSubtaskDraft,TodoListSections}.test.{ts,tsx}`、`lib/tasks.test.ts`、`lib/tasks/{inboxGrouping,taskTimeLabel,workbenchPrefs,taskRowZone,taskSort,turnTags,placement,subtasks,turnQueue}.test.ts`
**server**：`routes/tasks.test.ts`（GET + POST schedule）、`routes/agent.test.ts`（POST status，含“done=true 清 turn”）、`sync/tasks-domain.test.ts`、`sync/domains.test.ts`、`db/schema.test.ts`、`lib/db-rows.test.ts`
**shared**：`entitySchemas.test.ts`、`schemas.test.ts`、`taskCompletion.test.ts`、`recurrence.test.ts`（由 client 迁入）｜ **cli**：`commands/tasks.test.ts`

## 深水细节

- **`lib/tasks/turnQueue.ts`（`selectWaitingOnMe`/`selectRunning`）是孤儿**：仅自身测试引用，生产路径用 `turnTags.turnBuckets`。**不进 covers**，待清理。
- **`subtasks.applyParentToggle`/`deriveParentDone` 未接入生产**：父完成不自动全选子任务、反之亦然，只在测试用。
- **非重复排期任务过期后回到收件箱**不堆进今天；重复任务过期在“今天”区以红色“逾期 M月D日”标签呈现。
