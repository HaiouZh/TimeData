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
  - packages/client/src/lib/tasks/gravity.ts
  - packages/client/src/lib/tasks/gravityClock.ts
  - packages/client/src/lib/tasks/gravityReviewStorage.ts
  - packages/client/src/lib/useIsCoarsePointer.ts
  - packages/client/src/lib/settings/todoDefaultDestinationSetting.ts
  - packages/client/src/lib/settings/todoGravitySetting.ts
  - packages/client/src/pages/settings/SettingsTodoGravityPage.tsx
  - packages/client/src/pages/todo/SunkenInboxTail.tsx
  - packages/server/src/db/schema.ts
  - packages/server/src/lib/db-rows.ts
  - packages/server/src/routes/tasks.ts
  - packages/server/src/routes/agent.ts
  - packages/server/src/sync/domains.ts
  - packages/cli/src/commands/tasks.ts
last-reviewed: 2026-07-04
---
<!-- 复核 2026-07-02（同步提速 S1）：Dexie v15 仅物理删除 autoBackups 表（ADR 0015）；tasks schema、occurrence 语义与同步行为不变。 -->

# 待办任务

<!-- 复核 2026-07-04（同步 staleGuard）：shared reasonCode 扩展与 push 冲突仲裁变化不改变 Task 字段、重复规则、子任务或待办页面交互；P2 的完成语义意图化另行规划。 -->
<!-- 复核 2026-07-04（tasks 完成语义 op）：Task 字段和待办页面交互不变；同步层给完成字段增加 op 授权，防止无意图的标题/排序快照翻回勾选。 -->
<!-- 复核 2026-07-04（重复规则提前完成）：client 人工入口可提前完成未到期规则；server agent 未到期仍 409。 -->
<!-- 复核 2026-07-04（tracks 并发时间语义）：TrackStep.editedAt、tracks.status op 与 track_steps 宿主闸不改变 Task 字段、重复规则、子任务、完成语义 op 或待办页面交互。 -->

> 待办域的**主题文档**：`tasks` 表（轻量任务池 + 重复待办），跨端同步，不引用分类/时间记录/速记，不参与时长统计。
> 本文讲：Task 字段契约（含 `parentId` 一层父子）、四分区落点、三条写入通道、tags、子任务=独立可拖 Task、agent/CLI 回写、关键不变量。
> 重复规则引擎（Recurrence schema、spawn、终止条件、预设门）见子文档 [todo/recurrence](todo/recurrence.md)。
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
        → recordSyncLog 内 syncScheduler.notifyWrite() 自动调度（见 sync.md §1.6）
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
            · root note       → 新建独立 child Task（parentId 指向父任务），不再写父的内嵌数组
            · child note      → 409 TASK_CHILD_CANNOT_HAVE_CHILDREN，整次请求不做部分更新
            · tags        → 整体替换 tags
        → TaskSchema.parse(next) 再校验 → db.transaction（顺序：occurrence create/update →
           note child create → 父 next update）
        → notifySyncChange(getLatestSeq()) → 前台 SSE pull
```

`AGENT_TOKEN` 只在 `/api/agent/*` 生效，泄露影响面限于任务完成/备注/tags，不授予 sync、force-push、admin、export、reset。CLI 的 `task-*` 是该受控 API 的简化封装。

### 1.3 只读查询 + 排期写端点（第三条写入通道）

- `GET /api/tasks?kind=pool|recurring&done=0|1`（`routes/tasks.ts`）：严格 querySchema，SQL 层只取 `parent_id IS NULL` 的 root tasks，`ORDER BY sort_order, created_at, id`，`rowToTask` 映射后按 kind/done 过滤；受 `AUTH_TOKEN` 保护。
- `POST /api/tasks/:id/schedule { scheduledDate: "YYYY-MM-DD" | null }`（`routes/tasks.ts`）：CLI `task-schedule`/`task-unschedule` 调用，受 `AUTH_TOKEN` 保护；重复任务 409 `TASK_RECURRING_USE_RULE`。
  - **红线**：这条端点**直接 `UPDATE tasks SET scheduled_at, updated_at` + `recordSeq`，不走 `applyChange`/LWW 域**——即它**绕过了 LWW 的 schema 校验/冲突路径**。对比 agent 端点反而走 `applyChange`。这是 tasks 的第三条 server 写入通道（受控、AUTH_TOKEN、server 权威写），改 tasks 写入逻辑时三条通道都要照顾。

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
  weight: number;               // 默认 0；翻牌"顶一下"累加，增加抗沉天数
  completedAt: string | null;   // UTC ISO 或 null
  tags: string[];               // 默认 []，每项 NonEmptyTrimmed ≤64，max 50
  ruleId: string | null;          // 默认 null；occurrence 回指重复规则本体，普通 task / 规则本体恒 null
  skipped: boolean;               // 默认 false；occurrence 被"删这一发"消解时置 true，普通 task 恒 false
  sortOrder: number;            // int finite
  createdAt: string;            // 严格 UTC ISO（带毫秒+Z）
  updatedAt: string;            // 严格 UTC ISO（服务器分配）
}
```

时间字段一律 `UtcIsoStringSchema`：正则 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$` 且 `new Date(v).toISOString()===v`。

### 2.2 父子关系（`parentId`，一层约束）

子任务**就是普通 `Task` 行**，靠 `parentId` 指向 root，没有独立表、没有内嵌数组（旧的内嵌子任务数组模型已删除）。

- **只允许一层**：`child.parentId` 指向 `parentId===null` 的 root；child 自身不能再做父。写入侧三道防线：客户端 `createChildTask`/`moveTaskToParent` helper 校验，force-push 全量兜底校验（见 [sync](sync.md)），普通增量 push 不挡（单用户威胁模型取舍）。
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
| skipped | skipped | 0/1 ↔ boolean，默认 0 |
| created_at / updated_at | createdAt / updatedAt | UTC ISO（updated_at 服务器分配） |

映射：`rowToTask`（`lib/db-rows.ts`）、`taskToRow`（`sync/domains.ts`，不写 `updated_at`）。启动时幂等 `ALTER TABLE` 补列（`ensureTaskParentIdColumn` 给旧库补 `parent_id` + 索引，`ensureTaskWeightColumn` 给旧任务补 `weight=0`，`ensureTaskRuleIdColumn` 给旧任务补 `rule_id` + `idx_tasks_rule_id`，`ensureTaskSkippedColumn` 给旧任务补 `skipped=0`），并用 `dropColumnsIfExist` 删除旧目标归属列 `goal_id` 及索引。Dexie `tasks` 索引（v14）`"id, parentId, ruleId, scheduledAt, sortOrder, updatedAt"`（`client/src/db/index.ts`），`weight` 不建索引；`parentId` 入索引供 `db.tasks.where("parentId")` 拉 children；`ruleId` 入索引供 occurrence 查询；目标详情按 `Goal.members` 解引用任务，不再依赖任务侧索引。

客户端读取 `listTasks` 走 `TaskSchema.safeParse`（parse-on-read）：补默认、剥孤儿、坏行 `console.warn` 跳过；不再手摊默认字段。

### 2.4 同步域登记（`syncDomains.ts`）

`tasks` 域：`conflictPolicy:"lww"`、`countsInStatus:false`、upsert/deletePriority 45。服务端走通用 LWW（`sync/domains.ts`），无自定义 `validate`/`apply`/`crossValidate`，delete 写 tombstone。

## 3. 关键不变量 / 坑 / 红线

1. **完成走 occurrence 代理，模板不承载完成态（§9.2）**：非重复任务就地完成（`done=true` + `completedAt=now`），取消完成（仅客户端 `toggleTaskDone` 翻回）清 `completedAt=null`；重复模板完成代理到该 rule 的 occurrence——有 active 完成它，无 active 先按引擎物化到期发。client 人工入口在下一发未到期时会继续强制物化下一发并完成，允许提前消耗配额；server agent `done=true` 不提前完成，未到期/耗尽仍 409 `RULE_NOT_DUE`。模板的 `done`/`lastDoneAt`/`completedCount` 永不推进（纯遗留字段）；耗尽由账本判定（`isRuleExhausted`），耗尽模板保留 `recurrence`、由 `listTasks` 沉入 completed。旧 shared `completeTask`（衍生快照/终结转化）已退役删除。落点判据：普通任务仍是 `done`（`placement.ts`），模板是账本。细节见 [todo/recurrence](todo/recurrence.md) §3。
2. **"取消完成"两端仍不对称（root only）**：agent root `done=false` 仅置 `done=false`、**不清 `completedAt`**，而客户端 root reopen 会清 `completedAt=null`（且对 occurrence 会连删后来物化的 active 发防双 active）。child 是例外：agent child `done=true/false` 走轻量路径并与客户端子任务勾选对齐（true 写 now，false 清 `completedAt=null`）。撤销完成的 root 语义两端不一致，改前先确认。
3. **schedule 端点绕过 applyChange**（见 §1.3）：tasks 有三条 server 写通道（sync push 的 LWW apply、agent status 的 applyChange、schedule 的直写+recordSeq），机制不同。
4. **四分区是读时视图**：`today` / `inbox` / `scheduled` / `completed`，另有全量去重桶 `recurring` 供标签来源去重。P3 后 `today` 只读 pending occurrence（`ruleId!==null && !skipped && !done`），重复模板不再投影到今天，退到 `scheduled` 规则管理区；`scheduled` = 一次性未来排期 + 重复模板，按下一发生日升序，行内显示重复摘要与下一发生日；`completed` 收纳普通完成任务、done occurrence 与账本判耗尽的模板（`completedAt=null` 沉底），按 `completedAt` 倒序、**无日期过滤**；`scheduled` 内规则的下一发生日与耗尽判定读 occurrence 账本（`nextDueDate`/`isRuleExhausted`，§9.1），不再读模板死游标。改 `recurrence` 或 `startAt` 视为重锚：`startAt` 移到新值或当下，同事务级联删旧活跃 occurrence 及其 children、即时物化；锚点前历史发保留但不再计入配额/游标（#4 方案 b，见 [todo/recurrence](todo/recurrence.md) §3）；规则/起始日未变则保留进度。
5. **DnD 拓扑：顶层单一 `DndContext`，可拖区只有今天 / 收件箱 / 某 root 的 children**：`TodoPage` 顶层一个 `DndContext`，下挂 droppable/SortableContext 命名空间 `pool:today` / `pool:inbox` / `parent:<rootId>`；收件箱跨天只建**一个** SortableContext（按天分段只是 DOM 展示）。`upcoming`（已排期，按日期排序）/ `completed`（只读）/ `recurring`（不渲染）**都不参与拖拽**——每个任务在可拖范围内只渲染一次，draggable id 全局唯一。root 行的拖拽 activator 在行左 2/5 区域（复选框独立 `stopPropagation`，右侧标题区保留打开详情/选词）；有 children 的 root 左侧显示 caret，无 children 显示 grip 指示，图标只作提示。root→child 不再靠 600ms hover-intent 自动展开，而是 `todoDnd.resolveIndentLevel` 读取横向位移、**相对被拖项自身基线**判层级：拖根任务（base=root）右移达到 28px 判 child、回落到 12px 内判 root；拖子任务（base=child，由起拖容器是 `parent:*` 推出）静止恒为 child、向左越过 -28px 才升级 root、回到 -12px 内回落 child。这层基线区分是关键——子任务竖直重排（delta.x≈0）必须保持 child，否则会被误判成 root 而 `promoteToRoot` 拽出父任务。两侧都带滞回避免纵向排序时左右抖动误触；`clampTodoIndentPreview` 按基线把横向预览夹到根的 `0..28px` 或子的 `-28..0px`，拖拽期 `.todo-dnd-dragging .swipeable-list-item` 只放开纵向 overflow、横向继续 clip，避免向右拖拽把 `<main>` 撑出横向可滚面。`handleDragEnd` 经 `todoDnd.resolveTodoDragWithIndent`（内层仍是 `resolveTodoDragOperation`）结合 active container、over container、候选 root、目标池、root 是否已有 children 派发：同容器重排（池 `persistTaskOrder`、child `reorderChildren`）；child→pool→`promoteToRoot`；root/child→合法候选 root→`moveTaskToParent`（追加到目标父 children 末尾、`nextChildSortOrder` 取 max+1 不撞值；带 children 的 root 即使右移也不能降级）；root 在今天↔收件箱互拖→`scheduleTask`/`unscheduleTask`。`persistTaskOrder` 在 Dexie transaction 内回填现有 `sortOrder` 槽位、更新 `updatedAt`、为每个变化项写 `syncLog`，只对同作用域 ids 使用。**子任务重排走 `reorderChildren`**（非 `persistTaskOrder`）：child `sortOrder` per-parent 独立，回填连续 `0..n-1`（只写变化行）以自愈撞值脏数据（旧 `moveTaskToParent` 塞 `0` 或跨端同步的产物）——撞值时槽位回填式算不出变化会静默不写、"拖了不动"。拖拽中只高亮候选父，不提前展开真实 children；落定为 child 后目标父展开一次。
6. **`tags` 自由标签不驱动自动逻辑**（[ADR 0014](../adr/0014-task-tags-vs-fields.md)）：只供人/agent 语义标记 + 展示/检索层消费——`filterTasks` 三轴 AND 过滤（含 AND/OR、排除 NOT、标题关键词），`tagColor` 确定性派生颜色（hash 取模色板、不存储），`TagFilterPanel` 底部召唤式三态填色带计数筛选面，`TaskRow` 行内最多 3 chip 带色点。需要代码可靠动作的维度应毕业为结构化字段。
7. **子任务 = 独立可拖 `Task`（`parentId` 一层）**：见 §2.2。child 勾选不联动父 `done`/`completedAt`（父进度 `m/n` 由 `InlineChildren` 实时聚合，不回写父行）。pending occurrence 物化时克隆模板当前 children 的标题 / `tags` / 顺序，但新 occurrence children 一律 `done=false`、`completedAt=null` 起步；Today 展开的是这一发自己的 children，不回退读取模板 children。scheduled 管理区展开重复模板时，规则行子任务复选框只代理显示/写入该 rule 最新非 skipped occurrence child（无 occurrence 时置灰），模板 child 本体不承载完成态。**重复 root 完成不再动 children**：完成代理只写目标 occurrence 本体——client 侧 children 由物化引擎按模板克隆（`done=false` 起步），server agent 代理不镜像 children、也不 reset 模板 children（模板 child 的 `done` 已无读方）。历史 occurrence 的 children 在「已完成」内只读显示。
8. **目标层只从 Goal 侧引用 Task**：Goal 可以把 Task 写入 `Goal.members` 并读取 `done` 计算项目完成度或主题活跃度，但不会改变 Task 的完成、重复、排序、子任务或排期语义。删除 Goal 不改 Task；删除 Task 后，Goal 读取时把失效引用作为缺失成员提示。
9. **`tasks` 不引用分类/时间/速记/目标等业务域**：SQL 无外键，不参与分类校验/时间段重叠/时长统计/速记导入导出；目标组织关系属于 [goals](goals.md)，不回流到 Task schema。
10. **轨道不是子任务系统**：`tracks` / `track_steps` 是独立监控域（见 [tracks](tracks.md)），task 只会作为 `Ref{kind:"task"}` 被指向；轨道不镜像 `Task.done`、不回写父子进度，也不改变 `tasks` 的 force-push 契约。
11. **想法重力只作用于 root inbox 展示层**：`Task.weight` 是同步字段，`updatedAt` 提供时间衰减，`TodoPage` 在 `listTasks()` 出桶后把 inbox 拆成浮起/水下，并在本地跨日、focus、visibility 恢复时刷新当前水位日期；`listTasks()`、排期分桶、tag/search、DnD 域登记不改变。翻牌区是 today 附近的临时复查面，不注册 `sortable/containerId`；翻牌「已过目表」走 settings key `todo.gravity.review.v1`（`Record<taskId, iso>`，LWW 同步），展示即标记——`GravityReviewSection.drawBatch()` 发牌后经 `onMarkSurfaced` 写 settings，不写 Task、不刷新 `updatedAt`；`GravityReviewSection` 另维护本会话已标记 set 防止 settings 回流慢时「再翻几张」抽回刚展示过的任务。settings LWW 在极端并发下可能丢少量已过目标记，结果只是偶尔重复翻到，容错可接受。翻牌抽卡优先久未露面，其次 `weight` 作为温和 tie-breaker；`pickN>1` 时，已顶过的卡先从当前批移除并补抽，直到本轮额度耗尽。水下完整列表是 Inbox `DayGroupedList` 展开链条尾部的找回入口（`SunkenInboxTail`），不是新平级模块：浮层日期组不超过 3 个时尾部直接可达，浮层为 0 但仍有水下任务时也只渲染这个尾部入口；尾部默认收起，展开后渲染完整 `sunkenInbox`，不注册 `sortable/containerId`，`顶一下` 只 bump weight 不触发翻牌重抽；搜索/tag 过滤作用于尾部但不把水下任务混回默认浮层。

## 4. 模块速查

### 4.1 客户端

| 入口 | 职责 |
|---|---|
| `pages/TodoPage.tsx` | 顶层编排：`useLiveQuery(listTasks)` 取桶、持有筛选/搜索/展开状态（include/exclude/tagMode/notMode/filterOpen/composerText）、窄屏堆叠/宽屏 `ResizableSplit`、挂受控 `TodoComposer`（内嵌 `TagFilterPanel`）/`TaskDetailSheet`；gravity 水位线拆 `floatingInbox`/`sunkenInbox` + 渲染 `GravityReviewSection`，并在本地跨日/focus/visibility 恢复时刷新水位；支持 `/todo?taskId=<id>` 作为打开任务详情的 deep link，参数变化会切换抽屉目标，关闭抽屉只移除 `taskId` 并保留其他 query 参数，行点击仍只走本地打开状态、不写 URL |
| `pages/todo/TaskRow.tsx` | 扁平双行任务行：复选框（重复模板有下一发即可点，含未到期提前完成；耗尽才置灰）、左 2/5 root 拖拽抓取区、`CaretDown`/`CaretRight` 或 grip 纯指示、`rowClickZone` 派发展开/打开、meta 第二行、内联 children（`InlineChildren`，按池给 `draggable`/`static`/`readonly` mode）、缩进候选父高亮与落定后展开、刚物化 pending occurrence 短暂入场高亮（让追平下一发可被看见）；桌面细指针行尾 overlay 动作（排进今天 / 回收件箱 / 删除，由 `useIsCoarsePointer` 门控；换池箭头指向目标列）；可选 `extraAction` 行内插槽供翻牌区渲染「顶一下」 |
| `pages/todo/{TaskColumn,TaskList,SortableTaskRow}.tsx` | 列容器（仅 today/inbox 注册 droppable+SortableContext）/ `SwipeableList`（根与 item 带 `min-w-0`/横向裁剪约束，resize 后按当前容器宽度收缩，不保留旧 swipe 宽度）/ dnd-kit 包装（`useSortable` 带 `containerId`）；顶层 `DndContext` 在 `TodoPage`，列内不再各持 `DndContext` |
| `pages/todo/TaskDetailSheet.tsx` | 底部抽屉：`InlineChildren`、标题、tag、删除（普通任务 cascade；pending occurrence 删·跳）、重复预设 overlay；重复模板复选框有下一发即可代理完成（含未到期提前完成；耗尽置灰），逾期重复模板打开重复设置时用今天作为锚点；`parentId!==null`（child）隐藏 recurrence/tags/scheduledAt 高级控件 |
| `pages/todo/{InlineChildren,SortableChildRow,useTaskChildren,useLatestOccurrenceChildren,todoDnd}.*` | children 列表（三 mode；static 重复模板行用 `useLatestOccurrenceChildren` + `projectTemplateChildren` 把勾态投影到最新非 skipped occurrence child，无目标发置灰；新增走空白草稿行 `NewChildRow`：点 +子任务 或在某 child 编辑态回车都在末尾打开聚焦空输入框、不预填充、空标题不落库、回车提交非空后保持草稿连录；子任务标题默认是可跨行选择复制的 `span` 文本，无行尾编辑按钮，空选区点击或标题获焦后 Enter/F2 才进入编辑；编辑态 textarea 按内容与宽度变化自动增高、不保留内部滚动条，blur/Enter 提交，Escape 取消）/ 可拖 child 行 / `useLiveQuery` 拉 children hook / DnD 操作解析纯函数（container 解析、`resolveIndentLevel` 二元缩进、`clampTodoIndentPreview` 横向预览夹取、`resolveTodoDragWithIndent` 落点矩阵、`hoveredRootIdFromOver`） |
| `pages/todo/{DayGroupedList,TagFilterPanel,TodoComposer,ResizableSplit,CollapsibleSection}.tsx` | 分组列表（展开后的 sticky「收起」按钮按 `TodoPage` 计算出的底部避让值上移；当窄屏下滑把底栏和 composer 隐藏后，不再避让已不可见的输入栏；可选 `expandedFooter` 尾部插槽，在列表已完全展开、天然 ≤ `initialGroups` 或列表为空但有 footer 时渲染，供 Inbox 挂水下找回尾部）/ 展开态三态填色筛选面 / 底部操作栏（变身左键+搜索+建任务带 includeTags，fixed 高度由 `TodoPage` 测量给列表与主内容 padding 复用；`TodoPage` 传入当前移动底栏 offset 与隐藏状态，宽屏不套移动底栏避让；`zIndex=40` 压过任务行内部交互层、低于详情抽屉；下滑收起底栏时 `translateY(100%)` 整体滑出视口、上滑归位） / 双栏 / 折叠；折叠 caret 等交互图标经 Phosphor `Icon` 包装 |
| `lib/tasks.ts` | 核心 CRUD + `listTasks`（P3：today 读 pending occurrence、重复模板退 scheduled、skipped 排除、`recurring` 空桶兼容）/`putTask`；child helper `createChildTask`/`promoteToRoot`/`moveTaskToParent`/`deleteTaskCascade`；`toggleTaskDone` 对普通 child 走非重复路径、对重复模板 child 代理到当前可代理 occurrence child、对 pending occurrence 完成后即时物化下一发、对重复模板 root 代理完成下一发（无 active 且未到期时 client 强制物化下一发；耗尽 no-op）、对普通 root 就地完成；`bumpTaskWeight` 累加 `weight` 并写 syncLog；`markOccurrenceSkipped` 删·跳这一发（skipped 留痕）并即时物化下一发；`runMaterialization` 遍历 rule 物化当前 occurrence + occurrence children（in-flight 合并 + 事务内二次检查，children 从 `done=false`/`completedAt=null` 起步）；`updateTask` 重锚时同事务级联删活跃 pending occurrence 并即时尝试物化新 occurrence；`applyRecurrenceChoice` none/scheduled 同事务清孤儿 |
| `lib/tasks/{gravity,gravityReviewStorage,gravityClock}.ts` | 想法重力纯函数（`isTaskSunken`/`splitInboxByGravity`/`pickGravityReviewBatch`；抽卡按久未露面、`weight`、创建时间排序）+ 翻牌轮换记忆（settings key `todo.gravity.review.v1`，`useGravitySurfacedMap`/`markGravityTasksSurfaced`，写时 merge + prune `max(90, waterlineDays*4)` 天）+ 共享重力日期 helper（`currentGravityDate`/`msUntilNextLocalDay`，TodoPage 与设置页共用同一口径） |
| `pages/todo/GravityReviewSection.tsx` | 翻牌折叠复查区：展开时抽 `drawM` 张水下任务、最多顶 `pickN` 张、不注册 DnD；`↑ 顶一下` 经 `extraAction` 插槽渲染，顶过的卡在本轮额度内即时移出并补抽；展示即标记——`drawBatch()` 发牌后调 `onMarkSurfaced(ids, now)` 写 settings review key，并维护本会话已标记 set 避重 |
| `pages/todo/SunkenInboxTail.tsx` | Inbox 展开链条尾部的水下完整列表找回入口：默认收起「水下 X 条」，展开后按日期分组渲染完整 `sunkenInbox`，不注册 `sortable/containerId`；可选 `extraAction` 供「顶一下」只 bump weight |
| `lib/settings/todoGravitySetting.ts` | `todo.gravity.v1` JSON 设置包装（parse/sanitize/default/set/use） |
| `pages/settings/SettingsTodoGravityPage.tsx` | 「水位线与翻牌」设置子页（`/settings/todo-gravity`）：6 参数 autosave 调参 + 真实 inbox 水下数量预览 + 恢复默认；关闭水位线只让预览与 TodoPage 水位线短路，数字参数仍可编辑；连续 autosave 串行合并，避免快速操作互相覆盖；消费 `useTodoGravitySettings`/`setTodoGravitySettings`，预览用共享 `currentGravityDate` + `splitInboxByGravity` |
| `lib/tasks/{placement,taskSort,taskRowZone,taskTimeLabel,inboxGrouping,workbenchPrefs,turnTags,subtasks}.ts` | 落点 / 排序 / 点击分区 / 时间标签 / 收件箱+完成分组 / 折叠态+双栏比例 / tag 聚合(allTags)/三轴过滤(filterTasks)/取色(tagColor) / `subtaskProgress`（m/n 进度比例，children 数量喂入） |
| `lib/settings/todoDefaultDestinationSetting.ts` | composer 默认目标（`todo.defaultDestination.v1`，Dexie 同步） |
| 重复规则 | → [todo/recurrence](todo/recurrence.md) |

Todo 详情抽屉的标签删除、折叠区 caret、自定义重复的月末勾选等交互图标只改变视觉 glyph，统一经 Phosphor `Icon` 包装；按钮语义继续由现有文本与 `aria-label`（如 `删除标签 ${tag}`）承载，不改变任务 schema、同步或 recurrence 语义。

> 跨包：完成/物化纯计算 `shared/src/occurrence.ts`（`latestOccurrenceForRule`/`materializeDue`/`isRuleExhausted`/`nextDueDate`，client `toggleTaskDone`、server agent `done=true`、CLI `task-done` 共用同一「最新一发」代理语义）+ 日期助手 `shared/src/taskDates.ts`（`localDateOf`/`normalizeScheduledDate`）；重复引擎 `shared/src/recurrence.ts` 见 [recurrence](todo/recurrence.md)。

### 4.2 服务端 / CLI

| 入口 | 职责 |
|---|---|
| `routes/tasks.ts` | `GET /`（只读查询，只返回 root tasks）+ `POST /:id/schedule`（排期直写，重复 409，**不走 applyChange**） |
| `routes/agent.ts` | `POST /tasks/:id/status`（封闭动作，走 `applyChange` + `notifySyncChange`；重复模板 `done=true` 代理完成当前可代理 occurrence——active 则 update，无 active 经 `materializeDue` create 到期 occurrence，未到期/耗尽回 409 `RULE_NOT_DUE`，故意不开放提前完成；普通 root 就地完成；child `done` 只轻量更新自身 done/completedAt；root `note` 建独立 child Task，child `note` 409 拒绝） |
| `sync/domains.ts` | `tasks` 通用 LWW 注册 + `taskToRow`/`readTaskRecord` |
| `db/schema.ts` / `lib/db-rows.ts` | 建表/列迁移 + `rowToTask` |
| `cli/src/commands/tasks.ts` | `tasks` / `task-*` 命令（server API 封装） |

### 4.3 测试

**client**：`pages/TodoPage.test.tsx`、`pages/todo/{TaskRow,TaskColumn,TaskDetailSheet,DayGroupedList,SunkenInboxTail,TagFilterPanel,ResizableSplit,TodoComposer,InlineChildren,TodoListSections}.test.{ts,tsx}`、`pages/todo/todoDnd.test.ts`（二元缩进、横向预览夹取、落点矩阵）、`lib/tasks.test.ts`、`sync/clientDomains.test.ts`、`lib/tasks/{inboxGrouping,taskTimeLabel,workbenchPrefs,taskRowZone,taskSort,turnTags,placement,subtasks,gravityClock}.test.ts`
**server**：`routes/tasks.test.ts`（GET + POST schedule）、`routes/agent.test.ts`（POST status）、`sync/tasks-domain.test.ts`、`sync/domains.test.ts`、`db/schema.test.ts`、`lib/db-rows.test.ts`
**shared**：`entitySchemas.test.ts`、`schemas.test.ts`、`taskCompletion.test.ts`、`recurrence.test.ts`（由 client 迁入）｜ **cli**：`commands/tasks.test.ts`

## 深水细节

- **非重复排期任务过期后回到收件箱**不堆进今天；重复任务过期在“今天”区以红色日期呈现（当年 `m月d日`，跨年补年份 `yyyy年m月d日`），无“逾期”前缀。
