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
  - packages/client/src/lib/taskNesting.ts
  - packages/client/src/lib/tasks/placement.ts
  - packages/client/src/lib/tasks/taskSort.ts
  - packages/client/src/lib/tasks/taskRowZone.ts
  - packages/client/src/lib/tasks/todoTrackRows.ts
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
contracts:
  - packages/shared/src/types.ts:Task
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/taskCompletion.ts
  - packages/shared/src/taskDates.ts
  - packages/shared/src/syncDomains.ts
  - packages/server/src/db/schema.ts
last-reviewed: 2026-08-15
---

# 待办任务

> 待办域的**主题文档**：`tasks` 表（轻量任务池 + 重复待办），跨端同步，不引用分类/时间记录/速记，不参与时长统计。
> 本文讲：Task 字段契约（含 `parentId` 一层父子）、四分区落点、三条写入通道、tags、子任务=独立可拖 Task、agent/CLI 回写；不变量、坑与红线归纵切子文档 [todo/invariants](todo/invariants.md)。
> 重复规则引擎见子文档 [todo/recurrence](todo/recurrence.md)；想法重力（水位线/翻牌/水下找回）见子文档 [todo/gravity](todo/gravity.md)；手头软会话（抓/移/散/续 + atHand 排他投影）见子文档 [todo/at-hand](todo/at-hand.md)。项目区与归属轴已升格为邻居主题 [project-zone](project-zone.md)。不变量与坑见纵切子文档 [todo/invariants](todo/invariants.md)；代码入口地图见 [todo/modules](todo/modules.md)。
> 不讲：同步账本机制（见 [sync](sync.md)）、备份（见 [backup](backup.md)）、CLI 命令清单（见 [cli](cli.md)）。

## 承上启下

- **上游**：用户在 Web `TodoPage` 新增/编辑/勾选/排序；速记页 composer 「存待办」调 `addTask`；授权 agent / CLI 经 `POST /api/agent/tasks/:id/status` 回写状态；CLI 经 `POST /api/tasks/:id/schedule` 排期。
- **下游**：本地 Dexie `tasks` 与 `syncLog(tableName="tasks")` 同事务写 → [sync](sync.md) 推送 → 服务端通用 LWW 域 + `sync_seq` → 其他设备按 seq 拉取。force-push 里 `tasks` 是核心同步表之一（见 [backup](backup.md)）。
- **契约**：`Task` 字段 schema（含 `parentId` 一层父子）见本文 §2；`Recurrence` 见 [todo/recurrence](todo/recurrence.md)；跨域约定见 [data-model](data-model.md)；`tags` 不驱动自动逻辑（见 [ADR 0014](../adr/0014-task-tags-vs-fields.md)）。
- **邻居**：[quick-notes](quick-notes.md)（另一捕捉入口）、[goals](goals.md)（通过 `Goal.members` 引用 Task 作为目标成员）、[project-zone](project-zone.md)（项目区与归属轴）、[sync](sync.md)（LWW 域 + 登记簿）、[cli](cli.md)（`tasks` / `task-*` 命令）。

## 1. 数据流（本域端到端，跨包）

<a id="todo-s1-1"></a>

### 1.1 Web 端写入

```text
用户操作 → TodoPage / TaskDetailSheet
        → lib/tasks.ts: addTask/updateTask/toggleTaskDone/scheduleTask/unscheduleTask/
           setTaskTurn/setTaskTags/createChildTask/promoteToRoot/moveTaskToParent/
           deleteTask/deleteTaskCascade/persistTaskOrder/bumpTaskWeight
        → putTask(): db.transaction("rw", db.tasks, db.syncLog) 内
           db.tasks.put(next) + recordSyncLog("tasks", id, action, ts, completionOp?)
        → recordSyncLog 内 syncScheduler.notifyWrite() 自动调度（见 sync/realtime-and-scheduler.md §2）
        → POST /api/sync/push → server 通用 LWW 域（无自定义 apply）
           → taskToRow 写 SQLite tasks + 服务器分配 updated_at + recordSeq
        → sync_seq 记账 → notifySyncChange → 其他设备 SSE pull
```

所有本地写入（含 `persistTaskOrder` 批量重排）都在同一个 Dexie transaction 内同时写 `tasks` 与 `syncLog`；同步日志失败时业务写入回滚。可选 `completionOp` 由 `completionOp(prev, next, at)` 按 `done` / `completedAt` / `skipped` / `lastDoneAt` / `completedCount` 的 diff 推导：`putTask` 读 prev 行后自动带上，**另有约十处绕开 `putTask` 的事务直写点各自手传**（物化、跳过、重锚、批量迁移等，都在 `lib/tasks.ts` 内）——推导逻辑只有一份，入口不止一个。完成语义写入会随 syncLog 上行并带 `op`（四型及其**判定优先级** `complete > reopen > skip > amend`——`amend` 是兜底，见 [sync · tasks / tracks 语义 op](sync/push-pull.md#sync-tasks-tracks-op)）；改标题、改排序、改标签、改权重等非完成语义写入不附 `op`。服务端收到无 `op` 的 tasks upsert 时保留现存完成字段，只更新非守卫列，避免旧快照把另一设备的勾选翻回；**守卫只作用在 `ON CONFLICT DO UPDATE` 那一支**，行不存在时走 INSERT 全列写入——那时没有现存字段需要保护。`updated_at` 由服务器记账时分配，设备时钟漂移不影响同步正确性。客户端校验只为体验，服务端用登记簿 schema 重新解析并按 LWW + 完成字段守卫写入。

### 1.2 agent / CLI 回写任务状态

```text
agent / CLI (task-done/task-tag)
        → POST /api/agent/tasks/:id/status { done?, note?, tags? }
        → scopedAuthMiddleware（AUTH_TOKEN 或 AGENT_TOKEN，仅 /api/agent/* 生效）
        → routes/agent.ts: statusSchema 严格校验（至少一个字段）
        → 读当前 task，按 root / child 分流后构造 next：
            · root done=true 非重复 → 就地完成(done+completedAt)
            · root done=true 重复模板 → 代理到当前可代理 occurrence：有 active 完成它(update)；
                                无 active 先 materializeDue 物化再完成(create 确定性 id occurrence)；
                                无可发(未到期/耗尽) → 409 RULE_NOT_DUE；模板本体不动
            · root done=false → done=false 【不清 completedAt】
            · child done      → 轻量更新 done/completedAt（true 写 now，false 清 null）
            · root note       → 新建独立 child Task（parentId 指向父任务）
            · child note      → 409 TASK_CHILD_CANNOT_HAVE_CHILDREN，整次请求不做部分更新
            · tags        → 整体替换 tags
        → TaskSchema.parse(next) 再校验 → db.transaction（顺序：occurrence create/update →
           note child create → 父 next update）
        → notifySyncChange(getLatestSeq()) → 前台 SSE pull
```

`AGENT_TOKEN` 只在 `/api/agent/*` 生效，泄露影响面限于任务完成/备注/tags，不授予 sync、force-push、admin、export、reset。CLI 的 `task-*` 是该受控 API 的简化封装。

本节的动作集合只作用于**已有**任务；新建 root task 是另一条通道，见 §1.4。

<a id="todo-s1-3"></a>

### 1.3 只读查询 + 排期写端点（第三条写入通道）

- `GET /api/tasks?kind=pool|recurring&done=0|1`（`routes/tasks.ts`）：严格 querySchema，SQL 层只取 `parent_id IS NULL` 的 root tasks，`ORDER BY sort_order, created_at, id`，`rowToTask` 映射后按 kind/done 过滤；受 `AUTH_TOKEN` 保护。
- `POST /api/tasks/:id/schedule { scheduledDate: "YYYY-MM-DD" | null }`（`routes/tasks.ts`）：CLI `task-schedule`/`task-unschedule` 调用，受 `AUTH_TOKEN` 保护；重复模板 409 `TASK_RECURRING_USE_RULE`，occurrence（重复规则的这一发）409 `TASK_OCCURRENCE_NOT_SCHEDULABLE`——两个不同 code，让调用方区分「模板」与「这一发」。
  - **红线**：这条端点仍直接 `UPDATE tasks SET scheduled_at, updated_at`，不走 `applyChange`/LWW 域，因此绕过 LWW 的 schema 校验/冲突路径；但业务 UPDATE 与 `recordSeqWithDb` 已在同一个 SQLite transaction 内，记账失败会整体回滚，提交后再广播 SSE bump。它是 tasks 的第三条 server 写入通道（受控、AUTH_TOKEN、server 权威写），四条通道机制各不相同（并列见 [todo/invariants](todo/invariants.md) 第 3 条）。

<a id="todo-s1-4"></a>

### 1.4 agent 建任务（第四条写入通道）

`POST /api/agent/tasks`（`routes/agent.ts`）：受 `scopedAuthMiddleware` 保护，`requestId` 作幂等键兼 task id，走 `applyChange()` + `sync_seq` + `notifySyncChange()`，与 §1.2 同一条记账链路。形制照 [quick-notes](quick-notes.md) 的 agent 投递端点。

- **只建 root task，且不建重复任务**：请求体不含 `parentId` 与 `recurrence`，`.strict()` 下传任一即 400。接口形状上排除一层父子约束被绕过；重复模板仍只能由客户端建。
- **调用方拥有语义时间**：`createdAt` / `completedAt` 可回填历史；`updatedAt`、`change.timestamp`、`op.at` 三者由服务端取记账时刻。参与 LWW 比较的是前两者，`op` 只有**存在性**被消费（决定放不放行完成字段守卫列）。
- **`scheduledAt` 收完整 UTC ISO 时刻**，与 [§1.3](#todo-s1-3) 的 `POST /api/tasks/:id/schedule` 收 `YYYY-MM-DD` 再转本地午夜的形状不同；读取侧按本地日历日解释，跨时区回填会落到相邻日。
- **回填方向不对称**：向历史不设限，向未来卡 5 分钟容差；`completedAt < createdAt` 返回 400。`done=true` 必须带 `completedAt`，`done=false` 不得带。
- 完成态字段组对齐客户端非重复路径：`lastDoneAt` 恒 `null`、`completedCount` 恒 `0`、`skipped` 恒 `false`。
- 依据见 [ADR 0033](../adr/0033-agent-task-create-endpoint.md)。

同组另有一个只读端点 `GET /api/agent/tasks`，供写入方在建任务前比对既有条目、避免重复建；它是 `/api/agent/*` 下唯一的读端点。返回**全部未完成的根任务**，传 `completedSince`（严格 UTC ISO、不得早于 30 天前，否则 400）时追加该时刻之后完成的根任务。响应每条**只有 5 个字段**：`id` / `title` / `done` / `createdAt` / `completedAt`，不含 `tags` / `weight` / `sortOrder` / `scheduledAt`；不含子任务与重复模板。读边界的收窄理由见 ADR 0033「读边界」节。

<a id="todo-s2"></a>

## 2. Schema / 契约（字段级）

<a id="todo-s2-1"></a>

### 2.1 `Task`（`entitySchemas.ts:TaskSchema`）

```ts
{
  id: string;                   // NonEmptyTrimmed
  parentId: string | null;      // 默认 null；非空 = 该行是某 root 的子任务（仅一层）
  title: string;                // 保存前 trim，拒空
  done: boolean;
  recurrence: Recurrence | null; // 见 todo/recurrence
  lastDoneAt: string | null;    // UTC ISO 或 null
  startAt: string | null;
  scheduledAt: string | null;
  completedCount: number;       // 默认 0，int ≥0
  weight: number;               // 默认 0；翻牌"顶一下"累加，增加抗沉天数（见 todo/gravity）
  completedAt: string | null;   // UTC ISO 或 null
  tags: string[];               // 默认 []，每项 NonEmptyTrimmed ≤64，max 50
  ruleId: string | null;          // 默认 null；occurrence 回指重复规则本体，普通 task / 规则本体恒 null
  sessionId: string | null;       // 默认 null；反挂"手头"活跃/历史 session（见 todo/at-hand），历史归属指针不随散场清空
  skipped: boolean;               // 默认 false；occurrence 被"删这一发"消解时置 true，普通 task 恒 false
  sortOrder: number;            // int finite
  createdAt: string;            // 严格 UTC ISO（带毫秒+Z）
  updatedAt: string;            // 严格 UTC ISO（服务器分配）
}
```

时间字段一律 `UtcIsoStringSchema`：正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$` 且 `new Date(v).toISOString()===v`。

<a id="todo-s2-2"></a>

### 2.2 父子关系（`parentId`，一层约束）

子任务**就是普通 `Task` 行**，靠 `parentId` 指向 root，没有独立表、没有内嵌数组。

- **只允许一层**：`child.parentId` 指向 `parentId===null` 的 root；child 自身不能再做父。写入侧三道防线：客户端 `createChildTask`/`moveTaskToParent` helper 校验，force-push 全量兜底校验（见 [sync](sync.md)），普通增量 push 不挡——单用户威胁模型下的有意选择（尺度见 [AGENTS.md](../../AGENTS.md)「边界 · 审查尺度」）。
- **能力共享 + 行为收敛**：child 与 root 同 schema，所有字段保留。child 的 `recurrence`/`scheduledAt` 等高级字段**保留为休眠状态**，升回 root 自然恢复——**降级不清能力字段**。
- **子任务不持有归属指针**：归属由父接管，脱离父即归属为空。**用户视角的收纳走 `taskNesting.nestTaskUnderParent`，只有它保证**降级为 child 时**同事务清空两种归属**——`sessionId` 置 `null`（手头场），并从**所有**含它的 `goal.members` 里移除（项目名单）；升回 root 不恢复任何归属，落回收件箱等待重新安排。两者必须同一次 `db.transaction()`：分开提交会留下「既是 child、又占着项目名单」的状态，而投影层按 `parentId` 早退看不见它（`listTasks`），名单里它还在。复合动作落在 `lib/taskNesting.ts`（`goals.ts` 已单向 import `tasks.ts`，反向引用成环，故复合动作只能置于两者上层）。**底层原语** `lib/tasks.ts: moveTaskToParent` / `moveTaskToParentInCurrentTransaction` **只清 `sessionId`，不碰项目归属**（其自身注释已写明「不碰项目归属」）——直接调它而不经 `nestTaskUnderParent` 不会清空项目名单，任何新增调用点若是用户视角的「收纳」都应改走 `nestTaskUnderParent`。
  - child 的 `toggleTaskDone` 强制走非重复路径（无视休眠 `recurrence`，只翻 `done`/`completedAt`，不衍生 occurrence）；唯一例外是父任务为重复模板时，规则行子任务复选框代理到该 rule 最新非 skipped occurrence child，不写模板 child 本体。
  - child **不进 `placement`/`listTasks` 任何桶**（含 `recurring`），过滤写在 `listTasks` 循环最顶部 `if (t.parentId !== null) continue`；children 由 `useTaskChildren(parentId)` 按需单独 query。
  - UI 不渲染 child 的高级控件入口（`recurrence`/`tags`/`scheduledAt`）。
- **child 的 `sortOrder`** 仅在所属 parent 作用域内相对有效（与 root 共享全局空间，绝对值无意义）。
- **删除级联**：`deleteTaskCascade` 单事务删 root + 所有 direct children，每条写 `tasks/delete` syncLog（一层约束保证无 grandchildren）。对重复模板还连清其名下活跃 pending occurrence 及 children（done/skipped 历史发保留）；对模板子任务还连清活跃发里的确定性 id 镜像子任务（见 [recurrence](todo/recurrence.md#todo-recurrence-s3) 删除级联）。`TodoPage.remove` 非 occurrence 行统一走它（occurrence 走删·跳）。

<a id="todo-s2-3"></a>

### 2.3 SQL `tasks` ↔ JS 映射（`server/src/db/schema.ts`）

| SQL 列 | JS 字段 | 存储 |
|---|---|---|
| done | done | 0/1 ↔ boolean |
| parent_id | parentId | TEXT 或 NULL（有 `idx_tasks_parent_id` 索引，无 FK 约束） |
| recurrence / tags | 同名 | JSON 字符串（recurrence 可 NULL） |
| last_done_at / start_at / scheduled_at / completed_at | lastDoneAt / startAt / scheduledAt / completedAt | UTC ISO 或 NULL |
| completed_count / weight / sort_order | completedCount / weight / sortOrder | 整数 |
| rule_id | ruleId | TEXT 或 NULL（有 `idx_tasks_rule_id` 索引） |
| session_id | sessionId | TEXT 或 NULL（有 `idx_tasks_session_id` 索引；见 [todo/at-hand](todo/at-hand.md)） |
| skipped | skipped | 0/1 ↔ boolean，默认 0 |
| created_at / updated_at | createdAt / updatedAt | UTC ISO（updated_at 服务器分配） |

映射：`rowToTask`（`lib/db-rows.ts`）、`taskToRow`（`sync/domains.ts`，不写 `updated_at`）。启动时幂等 `ALTER TABLE` 补列（`ensureTaskParentIdColumn` / `ensureTaskWeightColumn` / `ensureTaskRuleIdColumn` / `ensureTaskSkippedColumn` / `ensureTaskSessionIdColumn` 给旧库补列与索引），并用 `dropColumnsIfExist` 删除废弃列 `goal_id` 及索引。Dexie `tasks` 索引串与完整 `stores()` 见 [data-model §10](data-model.md)，这里只讲**为什么是这几个字段**：`weight` 不建索引；`parentId` 入索引供 `db.tasks.where("parentId")` 拉 children；`ruleId` 入索引供 occurrence 查询；`sessionId` 入索引供 [todo/at-hand](todo/at-hand.md) 按场取未完任务/迁移；目标详情按 `Goal.members` 解引用任务，不依赖任务侧索引。

客户端读取 `listTasks` 走 `TaskSchema.safeParse`（parse-on-read）：补默认、剥孤儿、坏行 `console.warn` 跳过；不手摊默认字段。

### 2.4 同步域登记（`syncDomains.ts`）

`tasks` 域：`conflictPolicy:"lww"`、`countsInStatus:false`、upsert/deletePriority 45。服务端走通用 LWW（`sync/domains.ts`），无自定义 `validate`/`apply`/`crossValidate`，delete 写 tombstone。

## 3. 关键不变量 / 坑 / 红线

不变量、踩过的坑与红线（完成语义两端不对称、四分区读时视图、DnD 拓扑与缩进基线、归属轴排他等）见纵切子文档 [todo/invariants](todo/invariants.md)——改本域代码前先过一遍。

## 4. 模块速查

客户端 / 服务端 / CLI 的代码入口地图与测试落点见纵切子文档 [todo/modules](todo/modules.md)。

## 深水细节

- **非重复排期任务过期后回到收件箱**不堆进今天；重复任务过期在“今天”区以红色日期呈现（当年 `m月d日`，跨年补年份 `yyyy年m月d日`），无“逾期”前缀。
- **轨道行进区的两条硬约束**（`todoTrackRows.ts`）：① 轨道行必须渲染在 `TaskList` 的 `SortableContext` **之外**——`verticalListSortingStrategy` 按 DOM 顺序算位置，夹进任务行之间会扰乱落位；`TaskColumn` 的 `extra` 插槽就是为此留的（渲染在 `TaskList` 之后、与之同层）。② 去重只认 `useTaskTrackIndex` 的 `claimedTrackIds`：一条 active 轨道**要么**挂在某任务行的徽章上、**要么**自己独立成行，不会两处都有也不会两处都没有。**刻意不复用** `buildProgressItems` 的 `consumedTrackIds`——那份多一道“被认领的任务本身要进面板”的条件，轨道挂在子任务上时两处判定相反。
- **`TaskColumn.extra` 在无内容时必须传 `null`**：JSX 元素对象恒为 truthy，哪怕组件内部 `return null`，`empty = tasks.length === 0 && !extra` 也会被顶掉、空态文案不再显示，渲染结果是只剩标题与计数的空白卡片。React 判不了“一个 ReactNode 会不会渲染成空”，只能在**调用点**判。回归闸见 `TodoPage.test.tsx` 的“今天区没有任务也没有轨道时…”。

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [todo/invariants](todo/invariants.md) | 纵切：不变量 / 坑 / 红线，改代码前必读 |
| [todo/modules](todo/modules.md) | 纵切：代码入口地图与测试落点 |
| [todo/recurrence](todo/recurrence.md) | 重复规则引擎：Recurrence schema、occurrence 物化、终止条件、预设门、删除级联 |
| [todo/gravity](todo/gravity.md) | 想法重力：水位线浮沉、翻牌复查、已过目记忆、水下找回尾部、设置页 |
| [todo/at-hand](todo/at-hand.md) | 手头软会话：`Session` schema、sessions 域登记、抓/移/散/续生命周期、atHand 排他投影、自愈规则，以及与待办其他区域统一的标题 / 行面板 UI 骨架 |
| [todo/progress-axis](todo/progress-axis.md) | 推进轴投影：五桶语义、Task / Track / Goal 判桶、推进单元去重、进度三口径、与三轴的正交关系 |
