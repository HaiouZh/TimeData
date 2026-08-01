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
contracts:
  - packages/shared/src/types.ts:Task
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/schemas.ts
  - packages/shared/src/taskCompletion.ts
  - packages/shared/src/taskDates.ts
  - packages/shared/src/syncDomains.ts
  - packages/server/src/db/schema.ts
last-reviewed: 2026-08-01
---

# 待办任务

> 待办域的**主题文档**：`tasks` 表（轻量任务池 + 重复待办），跨端同步，不引用分类/时间记录/速记，不参与时长统计。
> 本文讲：Task 字段契约（含 `parentId` 一层父子）、四分区落点、三条写入通道、tags、子任务=独立可拖 Task、agent/CLI 回写、关键不变量。
> 重复规则引擎见子文档 [todo/recurrence](todo/recurrence.md)；想法重力（水位线/翻牌/水下找回）见子文档 [todo/gravity](todo/gravity.md)；手头软会话（抓/移/散/续 + atHand 排他投影）见子文档 [todo/at-hand](todo/at-hand.md)；项目区与归属轴（`Goal.members` → 分组投影 + 收件箱排他）见子文档 [todo/project-zone](todo/project-zone.md)。
> 不讲：同步账本机制（见 [sync](sync.md)）、备份（见 [backup](backup.md)）、CLI 命令清单（见 [cli](cli.md)）。

## 承上启下

- **上游**：用户在 Web `TodoPage` 新增/编辑/勾选/排序；速记页 composer 「存待办」调 `addTask`；授权 agent / CLI 经 `POST /api/agent/tasks/:id/status` 回写状态；CLI 经 `POST /api/tasks/:id/schedule` 排期。
- **下游**：本地 Dexie `tasks` 与 `syncLog(tableName="tasks")` 同事务写 → [sync](sync.md) 推送 → 服务端通用 LWW 域 + `sync_seq` → 其他设备按 seq 拉取。force-push 里 `tasks` 是核心同步表之一（见 [backup](backup.md)）。
- **契约**：`Task` 字段 schema（含 `parentId` 一层父子）见本文 §2；`Recurrence` 见 [todo/recurrence](todo/recurrence.md)；跨域约定见 [data-model](data-model.md)；`tags` 不驱动自动逻辑（见 [ADR 0014](../adr/0014-task-tags-vs-fields.md)）。
- **邻居**：[quick-notes](quick-notes.md)（另一捕捉入口）、[goals](goals.md)（通过 `Goal.members` 引用 Task 作为目标成员）、[sync](sync.md)（LWW 域 + 登记簿）、[cli](cli.md)（`tasks` / `task-*` 命令）。

## 1. 数据流（本域端到端，跨包）

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

所有本地写入（含 `persistTaskOrder` 批量重排）都在同一个 Dexie transaction 内同时写 `tasks` 与 `syncLog`；同步日志失败时业务写入回滚。`putTask` 会读 prev 行并用 `done` / `completedAt` / `skipped` / `lastDoneAt` / `completedCount` 的 diff 推导可选 `completionOp`，完成、撤勾、跳过和重复规则重锚这类完成语义写入会随 syncLog 上行；改标题、改排序、改标签、改权重等非完成语义写入不附 `op`。服务端收到无 `op` 的 tasks upsert 时保留现存完成字段，只更新非守卫列，避免旧快照把另一设备的勾选翻回。`updated_at` 由服务器记账时分配，设备时钟漂移不影响同步正确性。客户端校验只为体验，服务端用登记簿 schema 重新解析并按 LWW + 完成字段守卫写入。

### 1.2 agent / CLI 回写任务状态（封闭动作集合）

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

### 1.3 只读查询 + 排期写端点（第三条写入通道）

- `GET /api/tasks?kind=pool|recurring&done=0|1`（`routes/tasks.ts`）：严格 querySchema，SQL 层只取 `parent_id IS NULL` 的 root tasks，`ORDER BY sort_order, created_at, id`，`rowToTask` 映射后按 kind/done 过滤；受 `AUTH_TOKEN` 保护。
- `POST /api/tasks/:id/schedule { scheduledDate: "YYYY-MM-DD" | null }`（`routes/tasks.ts`）：CLI `task-schedule`/`task-unschedule` 调用，受 `AUTH_TOKEN` 保护；重复模板 409 `TASK_RECURRING_USE_RULE`，occurrence（重复规则的这一发）409 `TASK_OCCURRENCE_NOT_SCHEDULABLE`——两个不同 code，让调用方区分「模板」与「这一发」。
  - **红线**：这条端点仍直接 `UPDATE tasks SET scheduled_at, updated_at`，不走 `applyChange`/LWW 域，因此绕过 LWW 的 schema 校验/冲突路径；但业务 UPDATE 与 `recordSeqWithDb` 已在同一个 SQLite transaction 内，记账失败会整体回滚，提交后再广播 SSE bump。它是 tasks 的第三条 server 写入通道（受控、AUTH_TOKEN、server 权威写），三条通道机制各不相同（并列见 §3.3）。

## 2. Schema / 契约（字段级）

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

### 2.2 父子关系（`parentId`，一层约束）

子任务**就是普通 `Task` 行**，靠 `parentId` 指向 root，没有独立表、没有内嵌数组。

- **只允许一层**：`child.parentId` 指向 `parentId===null` 的 root；child 自身不能再做父。写入侧三道防线：客户端 `createChildTask`/`moveTaskToParent` helper 校验，force-push 全量兜底校验（见 [sync](sync.md)），普通增量 push 不挡——单用户威胁模型下的有意选择（尺度见 [AGENTS.md](../../AGENTS.md)「边界 · 审查尺度」）。
- **能力共享 + 行为收敛**：child 与 root 同 schema，所有字段保留。child 的 `recurrence`/`scheduledAt` 等高级字段**保留为休眠状态**，升回 root 自然恢复——**降级不清字段**。
  - child 的 `toggleTaskDone` 强制走非重复路径（无视休眠 `recurrence`，只翻 `done`/`completedAt`，不衍生 occurrence）；唯一例外是父任务为重复模板时，规则行子任务复选框代理到该 rule 最新非 skipped occurrence child，不写模板 child 本体。
  - child **不进 `placement`/`listTasks` 任何桶**（含 `recurring`），过滤写在 `listTasks` 循环最顶部 `if (t.parentId !== null) continue`；children 由 `useTaskChildren(parentId)` 按需单独 query。
  - UI 不渲染 child 的高级控件入口（`recurrence`/`tags`/`scheduledAt`）。
- **child 的 `sortOrder`** 仅在所属 parent 作用域内相对有效（与 root 共享全局空间，绝对值无意义）。
- **删除级联**：`deleteTaskCascade` 单事务删 root + 所有 direct children，每条写 `tasks/delete` syncLog（一层约束保证无 grandchildren）。对重复模板还连清其名下活跃 pending occurrence 及 children（done/skipped 历史发保留）；对模板子任务还连清活跃发里的确定性 id 镜像子任务（见 [recurrence](todo/recurrence.md) §3 删除级联）。`TodoPage.remove` 非 occurrence 行统一走它（occurrence 走删·跳）。

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

映射：`rowToTask`（`lib/db-rows.ts`）、`taskToRow`（`sync/domains.ts`，不写 `updated_at`）。启动时幂等 `ALTER TABLE` 补列（`ensureTaskParentIdColumn` / `ensureTaskWeightColumn` / `ensureTaskRuleIdColumn` / `ensureTaskSkippedColumn` / `ensureTaskSessionIdColumn` 给旧库补列与索引），并用 `dropColumnsIfExist` 删除废弃列 `goal_id` 及索引。Dexie `tasks` 索引（v16）`"id, parentId, ruleId, sessionId, scheduledAt, sortOrder, updatedAt"`（`client/src/db/index.ts`），`weight` 不建索引；`parentId` 入索引供 `db.tasks.where("parentId")` 拉 children；`ruleId` 入索引供 occurrence 查询；`sessionId` 入索引供 [todo/at-hand](todo/at-hand.md) 按场取未完任务/迁移；目标详情按 `Goal.members` 解引用任务，不依赖任务侧索引。

客户端读取 `listTasks` 走 `TaskSchema.safeParse`（parse-on-read）：补默认、剥孤儿、坏行 `console.warn` 跳过；不手摊默认字段。

### 2.4 同步域登记（`syncDomains.ts`）

`tasks` 域：`conflictPolicy:"lww"`、`countsInStatus:false`、upsert/deletePriority 45。服务端走通用 LWW（`sync/domains.ts`），无自定义 `validate`/`apply`/`crossValidate`，delete 写 tombstone。

## 3. 关键不变量 / 坑 / 红线

1. **完成走 occurrence 代理，模板不承载完成态**：非重复任务就地完成（`done=true` + `completedAt=now`），取消完成（仅客户端 `toggleTaskDone` 翻回）清 `completedAt=null`；重复模板完成代理到该 rule 的 occurrence——有 active 完成它，无 active 先按引擎物化到期发。client 人工入口在下一发未到期时会继续强制物化下一发并完成，允许提前消耗配额；server agent `done=true` 不提前完成，未到期/耗尽仍 409 `RULE_NOT_DUE`。模板的 `done`/`lastDoneAt`/`completedCount` 永不推进（纯遗留字段）；耗尽由账本判定（`isRuleExhausted`），耗尽模板保留 `recurrence`、由 `listTasks` 沉入 completed。落点判据：普通任务是 `done`（`placement.ts`），模板是账本。细节见 [todo/recurrence](todo/recurrence.md) §3。
2. **"取消完成"两端不对称（root only）**：agent root `done=false` 仅置 `done=false`、**不清 `completedAt`**，而客户端 root reopen 会清 `completedAt=null`（且对 occurrence 会连删后来物化的 active 发防双 active）。child 是例外：agent child `done=true/false` 走轻量路径并与客户端子任务勾选对齐（true 写 now，false 清 `completedAt=null`）。撤销完成的 root 语义两端不一致，是当前状态而非疏漏。
3. **schedule 端点绕过 applyChange**（见 §1.3）：tasks 有三条 server 写通道（sync push 的 LWW apply、agent status 的 applyChange、schedule 的事务内直写+记账），机制不同；schedule 必须保持提交后 SSE 通知。
4. **四分区是读时视图**：`today` / `inbox` / `scheduled` / `completed`，另有全量去重桶 `recurring` 供标签来源去重。`today` 只读 pending occurrence（`ruleId!==null && !skipped && !done`），重复模板不投影到今天，归入 `scheduled` 规则管理区；`scheduled` = 一次性未来排期 + 重复模板，按下一发生日升序，行内显示重复摘要与下一发生日，`listTasks` 同时给出 7 天水位线切点 `scheduledSunkenFromIndex`（第一个下一发生日超出「今天+7 天」的下标，本地日历口径与排序键一致），UI 把切点后的行折叠进 `SunkenScheduledTail`「更远还有 N 条」（搜索/标签过滤激活时水位线失效、命中即显示）；`completed` 收纳普通完成任务、done occurrence 与账本判耗尽的模板（`completedAt=null` 沉底），按 `completedAt` 倒序、**无日期过滤**；`scheduled` 内规则的下一发生日与耗尽判定读 occurrence 账本（`nextDueDate`/`isRuleExhausted`），不读模板游标。改 `recurrence` 或 `startAt` 视为重锚：`startAt` 移到新值或当下，同事务级联删旧活跃 occurrence 及其 children、即时物化；锚点前历史发保留但不计入配额/游标；规则/起始日未变则保留进度（见 [todo/recurrence](todo/recurrence.md) §3）。
5. **DnD 拓扑：顶层单一 `DndContext`，可拖区只有今天 / 收件箱 / 某 root 的 children / 手头区未完成行**。
   - **拓扑**：`TodoPage` 顶层一个 `DndContext`，下挂 droppable/SortableContext 命名空间 `pool:today` / `pool:inbox` / `parent:<rootId>` / 手头 `hand`；收件箱按天分段，**每段各建一个 SortableContext**（容器 id 都是 `pool:inbox`）。`upcoming` / `completed` / `recurring` / 水下找回尾部 **不参与拖拽**——每个任务在可拖范围内只渲染一次，draggable id 全局唯一。root 行拖拽 activator 在行左 2/5 区域（复选框独立 `stopPropagation`，右侧标题区保留打开详情/选词）。
   - **缩进判定**（`todoDnd.resolveIndentLevel`）：层级由横向位移**相对被拖项自身基线**判定，两侧带滞回防纵向排序抖动误触。

     | 起拖基线 | 判 child | 回落 root/child | 静止时 |
     |---|---|---|---|
     | root（从池起拖） | 右移 ≥28px | ≤12px 回 root | root |
     | child（从 `parent:*` 起拖） | 恒 child；左移越过 -28px 才升 root | 回 -12px 内回落 child | child |

     基线区分是关键红线：子任务竖直重排（delta.x≈0）必须保持 child，否则会被误判成 root 而 `promoteToRoot` 拽出父任务。`clampTodoIndentPreview` 按基线把横向预览夹到根 `0..28px` / 子 `-28..0px`；拖拽期 `.todo-dnd-dragging .swipeable-list-item` 只放开纵向 overflow、横向继续 clip，防右拖把 `<main>` 撑出横向可滚面。
   - **落点派发**（`handleDragEnd` → `todoDnd.resolveTodoDragWithIndent`，内层 `resolveTodoDragOperation`）：结合 active/over container、候选 root、目标池、root 是否已有 children 派发——同容器重排（池 `persistTaskOrder`、child `reorderChildren`）；child→pool→`promoteToRoot`；root/child→合法候选 root→`moveTaskToParent`（追加到目标父 children 末尾、`nextChildSortOrder` 取 max+1 不撞值；带 children 的 root 即使右移也不能降级）；root 在今天↔收件箱互拖→`scheduleTask`/`unscheduleTask`；root（仅池容器、`activeParentId === null`）→ `project:<goalId>` → `assign-to-project`（**不动 `scheduledAt`**，归属轴与时间轴正交），子任务落在项目组一律判 `null`（不做「先升根再入组」的复合动作）。项目组容器的落点契约、碰撞策略与准入判定见 [todo/project-zone](todo/project-zone.md) §6。
   - **重排写入**：`persistTaskOrder` 在 Dexie transaction 内回填现有 `sortOrder` 槽位、更新 `updatedAt`、为每个变化项写 `syncLog`，只对同作用域 ids 使用。**child 重排必须走 `reorderChildren`**（非 `persistTaskOrder`）：child `sortOrder` per-parent 独立，回填连续 `0..n-1`（只写变化行）以自愈撞值脏数据——撞值时槽位回填式算不出变化会静默不写、"拖了不动"。**池同容器重排只有今天**：收件箱显示序 = 按 `createdAt` 分天 + 段内 `createdAt` 倒序（`inboxGrouping.ts`），不读 `sortOrder`，落库既弹回又把 `updatedAt` 推到当下、重置该行的重力下沉时钟（`isTaskSunken` 读 `updatedAt`），故 `resolveTodoDragOperation` 对 `pool:inbox` 同容器直接返回 `null`；收件箱行仍注册 sortable——拖去今天（`schedule-root`）与缩进成子任务（`move-to-parent`）依赖它。
   - 拖拽中只高亮候选父、不提前展开真实 children；落定为 child 后目标父展开一次。
6. **`tags` 自由标签不驱动自动逻辑**（[ADR 0014](../adr/0014-task-tags-vs-fields.md)）：只供人/agent 语义标记 + 展示/检索层消费——`filterTasks` 三轴 AND 过滤（含 AND/OR、排除 NOT、标题关键词），同一筛选投影覆盖普通任务池与项目区，手头区保持焦点隔离不受影响；标签色走 `lib/contentTint.ts` 的 `contentTint(标签名)`（确定性、不存储，见 [design-language](design-language.md) §1），`TagFilterPanel` 底部召唤式三态填色带计数筛选面，`TaskRow` 行内最多 3 chip、着色的 `#` 标类型（圆点归项目）。项目区筛选的展开与空态契约见 [todo/project-zone](todo/project-zone.md) §5；需要代码可靠动作的维度应毕业为结构化字段。
7. **子任务 = 独立可拖 `Task`（`parentId` 一层）**：见 §2.2。child 勾选不联动父 `done`/`completedAt`（父进度 `m/n` 由 `InlineChildren` 实时聚合，不回写父行）。pending occurrence 物化时克隆模板当前 children 的标题 / `tags` / 顺序，但新 occurrence children 一律 `done=false`、`completedAt=null` 起步；Today 展开的是这一发自己的 children，不回退读取模板 children。scheduled 管理区展开重复模板时，规则行子任务复选框只代理显示/写入该 rule 最新非 skipped occurrence child（无 occurrence 时置灰），模板 child 本体不承载完成态。**重复 root 完成不动 children**：完成代理只写目标 occurrence 本体——client 侧 children 由物化引擎按模板克隆（`done=false` 起步），server agent 代理不镜像 children、也不 reset 模板 children（模板 child 的 `done` 无读方）。历史 occurrence 的 children 在「已完成」内只读显示。
8. **目标层只从 Goal 侧引用 Task**：Goal 可以把 Task 写入 `Goal.members` 并读取 `done` 计算项目完成度或主题活跃度，但不会改变 Task 的完成、重复、排序、子任务或排期语义。删除 / 归档 Goal 不改 Task 的上述任何语义，**只刷新受影响成员的 `updatedAt`**（见第 13 条，这是重力可见性所需，不是状态变更）；删除 Task 后，Goal 读取时把失效引用作为缺失成员提示。
9. **`tasks` 不引用分类/时间/速记/目标等业务域**：SQL 无外键，不参与分类校验/时间段重叠/时长统计/速记导入导出；目标组织关系属于 [goals](goals.md)，不回流到 Task schema。
10. **轨道不是子任务系统**：`tracks` / `track_steps` 是独立监控域（见 [tracks](tracks.md)），task 只会作为 `Ref{kind:"task"}` 被指向；轨道不镜像 `Task.done`、不回写父子进度，也不改变 `tasks` 的 force-push 契约。
11. **想法重力只作用于 root inbox 展示层**：`Task.weight` 同步字段 + `updatedAt` 时间衰减，`TodoPage` 出桶后把 inbox 拆浮起/水下；`listTasks()`、排期分桶、tag/search、DnD 域登记都不感知。水位线 / 翻牌复查 / 已过目记忆 / 水下找回尾部 / 设置见 [todo/gravity](todo/gravity.md)。
12. **手头投影**：`Task.sessionId` 指向活跃 session 的 root（非重复模板）不进 `today`/`inbox`/`scheduled`，只出现在手头卡；散场零迁移自然回桶——`sessionId` 不清空，只是排他条件（等于*当前*活跃场 id）不再成立。`sessionId` 是历史归属指针，不是"当前状态"标记。手头区未完成行支持区内拖拽重排（容器 `hand`，只交换这些行的全局 `sortOrder` 槽位，散场后回桶顺序保留同一序）；手头行不参与缩进（`clampTodoIndentPreview` 夹 0）、不开放拖出手头（`todoDockTargets` 对手头源不显示坞，`resolveTodoDockDrop` 拦 invalid）。详见 [todo/at-hand](todo/at-hand.md)。
13. **项目区与归属轴**：`Goal(kind="project", status="active")` 的成员任务在待办页聚成「项目区」，并对收件箱**排他**——成员不进 `inbox`，收件箱因此回归「真·未归类托盘」；焦点轴（手头）与时间轴（今天/已排期）与它正交，成员同时出现在对应桶与项目区。两份 goal→task 索引口径不同且**不得互相派生**，归属变更必须同事务刷新成员 `updatedAt`（重力可见性所需）。完整契约（投影规则、排他红线、写入不变量、呈现约定）见 [todo/project-zone](todo/project-zone.md)。
14. **投递坞不发明语义**：宽屏拖拽中贴着**来源区块左缘**浮现的瞬态落点按钮（`TodoDragDock`，拖起时量 `[data-section]` 左缘定位，量不到退回视口右缘;锚左缘是为了让奔向坞的行程向左——向右正是缩进变子任务的手势方向），`dock:pool:*`/`dock:project:*` 折算成既有容器走 `resolveTodoDragOperation`，`dock:hand` = `grabTaskToHand`；坞永不产生 reorder（`resolveTodoDockDrop` 拦截）。坞常驻挂载只切透明度、`pointer-events` 仅拖拽中放开（坞内滚动需要接滚轮，平时 none 不拦点击），仅宽屏渲染；被拖行所在池的药丸不显示，**拖子任务时「手头」药丸也不显示**（`grabTaskToHand` 拒收子任务，不给必失败落点，解析层同拦成 invalid）；子任务投项目药丸的拒绝口径与项目卡一致。`preferProjectCollisions` 中坞命中优先于项目组与行；`hoveredRootIdFromOver` 对 dock id 恒返回 `null`（坞不是缩进落点）。

## 4. 模块速查

### 4.1 客户端

| 入口 | 职责 |
|---|---|
| `pages/TodoPage.tsx` | 顶层编排：`useLiveQuery(listTasks)` 取桶，持有筛选/搜索/展开状态，窄屏堆叠 / 宽屏 `ResizableSplit`。**两处跨文档接线**：重力水位线在排他之后拆 `floatingInbox`/`sunkenInbox`（顺序不可换，见 [todo/gravity](todo/gravity.md)）；`useEffect` 依 `buckets.handSession?.id` 触发 `healActiveSessions`（见 [todo/at-hand](todo/at-hand.md)）。`/todo?taskId=<id>` 是打开详情的 deep link：参数变化切换抽屉目标，关抽屉只移除 `taskId`、**保留其他 query**，行点击不写 URL |
| `pages/todo/TaskRow.tsx` | 扁平双行任务行（拖拽区、点击分区、内联 children、行尾 overlay 动作、入场高亮的具体构成读组件）。三处易错语义：复选框对重复模板**有下一发即可点**（含未到期提前完成），仅耗尽置灰；多选态下整行语义切成 `role="checkbox"`（点击 / Enter / Space 都是勾选），而**复选框仍是「完成」**（见 [todo/project-zone](todo/project-zone.md) §7）；键盘两支共用一道 `event.target !== event.currentTarget` 闸，否则焦点在内层复选框上按键会连带勾选 |
| `pages/todo/{TaskColumn,TaskList,SortableTaskRow}.tsx` | 列容器（**仅 today/inbox 注册 droppable + SortableContext**）/ `SwipeableList` / dnd-kit 包装。`DndContext` 只在 `TodoPage` 顶层，列内不各持。`fullSwipe={false}` 是**有意设计**：trailing 末项是删除、全滑会误删，故滑到头不自动触发。selection 三 prop（`selectionMode`/`selectedIds`/`onToggleSelect`）在收件箱的**三处渲染点各自显式透传**，不经 `...rowHandlers` 展开——漏一处就是那一段列表无法多选 |
| `pages/todo/TaskDetailSheet.tsx` | 底部抽屉：标题 / tag / 删除（普通任务 cascade、pending occurrence 删·跳）/ 重复预设。重复模板复选框有下一发即可代理完成；逾期模板打开重复设置时用今天作锚点；child（`parentId!==null`）隐藏 recurrence/tags/scheduledAt 高级控件（§2.2） |
| `pages/todo/{InlineChildren,SortableChildRow,useTaskChildren,useLatestOccurrenceChildren,todoDnd}.*` | children 列表三 mode（`draggable`/`static`/`readonly`）+ 可拖 child 行 + `useLiveQuery` 拉取 hook。`static`（重复模板行）经 `projectTemplateChildren` 把勾态投影到最新非 skipped occurrence child，无目标发置灰。新增走末尾空白草稿行 `NewChildRow`：空标题不落库、回车提交后保持草稿连录；标题默认是可跨行选择复制的文本，Enter/F2 才进编辑。DnD 纯函数在 `todoDnd`：`resolveIndentLevel` / `clampTodoIndentPreview` / `resolveTodoDragWithIndent` / `hoveredRootIdFromOver`（语义见 §3.5） |
| `pages/todo/TodoDragDock.tsx` | 拖拽投递坞：宽屏瞬态落点药丸（今天/手头/收件箱/各项目），`dock:` id 域与落点解析在 `todoDnd.ts`（§3.14）。`TodoPage` 传 `dragging`/被拖行容器 id/项目清单/`dropBlocked` 四项接线 |
| `pages/todo/{DayGroupedList,TagFilterPanel,TodoComposer,ResizableSplit,CollapsibleSection}.tsx` | 分组列表 / 三态填色筛选面 / 底部操作栏 / 双栏 / 折叠。两处耦合：`DayGroupedList` 的 `expandedFooter` 插槽供 Inbox 挂水下找回尾部（见 [todo/gravity](todo/gravity.md)）；`TodoComposer` 的 fixed 高度由 `TodoPage` 测量后复用给列表与主内容的 padding，窄屏还要叠移动底栏的 offset 与隐藏态 |
| `lib/tasks.ts` | 核心 CRUD + `listTasks` 出四分区（§3.4）+ `putTask`（同事务写 `tasks`+`syncLog`，diff 推导 `completionOp`，§1.1）。child helper：`createChildTask` / `promoteToRoot` / `moveTaskToParent` / `deleteTaskCascade`。`toggleTaskDone` 按 child / occurrence / 重复 root / 普通 root 四路分流，语义见 §3.1、§3.7。`runMaterialization` 物化当前 occurrence + children，**靠 in-flight 合并加事务内二次检查防重复物化**；`updateTask` 重锚同事务级联删活跃 occurrence 再物化（§3.4）；`markOccurrenceSkipped` 删·跳留痕并物化下一发；`bumpTaskWeight` 累加 `weight`（见 [todo/gravity](todo/gravity.md)） |
| `lib/tasks/{placement,taskSort,taskRowZone,taskTimeLabel,inboxGrouping,workbenchPrefs,turnTags,subtasks}.ts` | 落点 / 排序 / 点击分区 / 时间标签 / 收件箱+完成分组 / 折叠态+双栏比例 / tag 聚合(allTags)/三轴过滤(filterTasks) / `subtaskProgress`（m/n 进度比例，children 数量喂入） |
| `lib/settings/todoDefaultDestinationSetting.ts` | composer 默认目标（`todo.defaultDestination.v1`，Dexie 同步） |
| 重复规则 | → [todo/recurrence](todo/recurrence.md) |
| 想法重力（水位线/翻牌/`GravityReviewSection`/`SunkenInboxTail`/设置页） | → [todo/gravity](todo/gravity.md) |
| 手头软会话（`lib/sessions.ts` 生命周期 / `AtHandSection.tsx` 卡片 / atHand 排他投影） | → [todo/at-hand](todo/at-hand.md) |

交互图标统一经 Phosphor `Icon` 包装（规则见 [design-language](design-language.md) §4），按钮语义由文本与 `aria-label`（如 `删除标签 ${tag}`）承载。

> 跨包：完成/物化纯计算 `shared/src/occurrence.ts`（`latestOccurrenceForRule`/`materializeDue`/`isRuleExhausted`/`nextDueDate`，client `toggleTaskDone`、server agent `done=true`、CLI `task-done` 共用同一「最新一发」代理语义）+ 日期助手 `shared/src/taskDates.ts`（`localDateOf`/`normalizeScheduledDate`）；重复引擎 `shared/src/recurrence.ts` 见 [recurrence](todo/recurrence.md)。

### 4.2 服务端 / CLI

| 入口 | 职责 |
|---|---|
| `routes/tasks.ts` | `GET /`（只读查询，只返回 root tasks）+ `POST /:id/schedule`（排期事务内直写+记账、提交后 SSE，重复 409，**不走 applyChange**） |
| `routes/agent.ts` | `POST /tasks/:id/status`（封闭动作，走 `applyChange` + `notifySyncChange`；重复模板 `done=true` 代理完成当前可代理 occurrence——active 则 update，无 active 经 `materializeDue` create 到期 occurrence，未到期/耗尽回 409 `RULE_NOT_DUE`，故意不开放提前完成；普通 root 就地完成；child `done` 只轻量更新自身 done/completedAt；root `note` 建独立 child Task，child `note` 409 拒绝） |
| `sync/domains.ts` | `tasks` 通用 LWW 注册 + `taskToRow`/`readTaskRecord` |
| `db/schema.ts` / `lib/db-rows.ts` | 建表/列迁移 + `rowToTask` |
| `cli/src/commands/tasks.ts` | `tasks` / `task-*` 命令（server API 封装） |

### 4.3 测试

**client**：`pages/TodoPage.test.tsx`、`pages/todo/{TaskRow,TaskList,TaskColumn,TaskDetailSheet,DayGroupedList,SunkenInboxTail,TagFilterPanel,TodoProjectSection,ResizableSplit,TodoComposer,TodoSelectionBar,InlineChildren,CollapsibleSection,TodoListSections}.test.{ts,tsx}`、`pages/todo/todoDnd.test.ts`（二元缩进、横向预览夹取、落点矩阵、投递坞 id 域与落点解析）、`pages/todo/TodoDragDock.test.tsx`（药丸集合/显隐/禁用态）、`lib/tasks.test.ts`、`sync/clientDomains.test.ts`、`lib/tasks/{inboxGrouping,taskTimeLabel,workbenchPrefs,taskRowZone,taskSort,turnTags,placement,subtasks}.test.ts`（重力相关见 [todo/gravity](todo/gravity.md)；手头相关见 [todo/at-hand](todo/at-hand.md)）
**server**：`routes/tasks.test.ts`（GET + POST schedule）、`routes/agent.test.ts`（POST status）、`sync/tasks-domain.test.ts`、`sync/domains.test.ts`、`db/schema.test.ts`、`lib/db-rows.test.ts`
**shared**：`entitySchemas.test.ts`、`schemas.test.ts`、`taskCompletion.test.ts`、`recurrence.test.ts` ｜ **cli**：`commands/tasks.test.ts`

## 深水细节

- **非重复排期任务过期后回到收件箱**不堆进今天；重复任务过期在“今天”区以红色日期呈现（当年 `m月d日`，跨年补年份 `yyyy年m月d日`），无“逾期”前缀。

## 子文档索引

| 子文档 | 拥有什么 |
|---|---|
| [todo/recurrence](todo/recurrence.md) | 重复规则引擎：Recurrence schema、occurrence 物化、终止条件、预设门、删除级联 |
| [todo/gravity](todo/gravity.md) | 想法重力：水位线浮沉、翻牌复查、已过目记忆、水下找回尾部、设置页 |
| [todo/at-hand](todo/at-hand.md) | 手头软会话：`Session` schema、sessions 域登记、抓/移/散/续生命周期、atHand 排他投影、自愈规则，以及与待办其他区域统一的标题 / 行面板 UI 骨架 |
| [todo/project-zone](todo/project-zone.md) | 项目区与归属轴：两份 goal→task 索引、分组投影、收件箱排他、归属变更 touch 不变量、呈现契约 |
