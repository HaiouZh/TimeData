---
type: evergreen
title: 目标层
covers:
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/goalLayoutPins.ts
  - packages/shared/src/syncDomains.ts
  - packages/server/src/lib/goal-rows.ts
  - packages/server/src/lib/goal-layout-pin-rows.ts
  - packages/server/src/sync/domains.ts
  - packages/client/src/lib/goalLayoutPins.ts
  - packages/client/src/lib/goals.ts
  - packages/client/src/lib/goalsView.ts
contracts:
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/goalLayoutPins.ts
  - packages/shared/src/syncDomains.ts
  - packages/server/src/sync/domains.ts
last-reviewed: 2026-08-21
---

# 目标层

> Goal 是轻量目标层：把 Task 点和 Track 线收编到一个目标下，看项目完成度、主题近期活跃度和成员前置关系。它不是全局依赖图，也不替代 todo / tracks 自身语义。
> 本文讲：`Goal` schema 与 typed 前置、存储与同步域、成员解引用与 roll-up 口径、数据侧不做清单。视图与就地编辑面见子文档索引。

## 子文档索引

- [goals/canvas](goals/canvas.md) —— 星图画布：`/goals` 全局星图与 `/goals/:id` 局部图编辑器的视图模式、确定性布局纯函数分层、就地编辑与 pin 写入、未归类托盘与拖入、引擎模式开关、画布侧模块速查。

## 承上启下

- **上游**：用户在 `/goals` 新建 `project` / `theme`，在 `/goals/:id` 编辑标题、备注、状态、成员和前置关系。
- **下游**：Web 写入 Dexie 业务表并同事务写 `syncLog` → [sync](sync.md) 的 `goals` LWW 域 → server SQLite `goals` 表 → 其他设备按 `sync_seq` pull。
- **契约**：`Goal` schema 持有 `members` 与 typed `prerequisites`；Task / Track 不保存 Goal 归属。跨表映射见 [data-model](data-model.md)；完整备份见 [backup](backup.md)。
- **邻居**：[todo](todo.md) 的 `done` / 重复规则和 [tracks](tracks.md) 的 `status` / steps 都保持原语义，Goal 只做组织视图、展示和前置边解释。

## 1. Schema

`Goal`：

```ts
{
  id: string;
  title: string;
  kind: "project" | "theme";
  status: "active" | "archived";
  note?: string;
  members: Array<{ kind: "task" | "track"; id: string }>;
  prerequisites: Array<{
    blocker: { kind: "task" | "track"; id: string };
    blocked: { kind: "task" | "track"; id: string };
  }>;
  createdAt: string;
  updatedAt: string;
}
```

成员关系存在 Goal 侧：`Goal.members` 是 typed 引用集合，成员只允许 `task` / `track`。同一个 Task / Track 可以被多个 Goal 引用；删除 Goal 只删除 Goal，不改 Task/Track 的任何业务语义——唯一的例外是**active project 归属发生变化的 task 成员会被同事务刷新 `updatedAt`**：失去归属的四条通道（删除、归档、`kind` 改 theme、`members` 移除）如此，`addGoalMember` 加入 active project 亦同。为的是让归属变化后的任务浮在重力水位线之上，详见 [project-zone](project-zone.md#project-zone-ownership-write)。

待办页的项目区是 `Goal.members` 的第二个写入面：行内「退出项目」调 `removeGoalMember`，与星图/未归类托盘写的是同一份 `members`。读侧口径不同——托盘覆盖 today/inbox/scheduled 三池并排除重复模板，项目区只对 inbox 做排他。详见 [project-zone](project-zone.md)。

`prerequisites` 是目标内部成员之间的 typed 有向边：`blocker` 必须先完成，`blocked` 才算可推进。shared schema 拒绝重复成员、前置边引用非成员、自环、重复边和环；UI roll-up 对历史坏数据仍宽容，会忽略缺失成员和指向非有效成员的前置边并保留低调提示。

<a id="goals-s2"></a>

## 2. 存储与同步

`goals` 是一等同步域，`conflictPolicy:"lww"`、`countsInStatus:false`、priority 72。服务端走通用 LWW，SQLite `goals.members` 与 `goals.prerequisites` 都存 JSON 字符串；`tasks` / `tracks` 不再有 `goal_id` 归属列，新库不建，旧库启动时幂等 drop。`Goal` 实体本身不保存坐标或布局字段。

客户端 Dexie 保留 `goals: "id, kind, status, updatedAt"`，并自 v12 起有 `goalLayoutPins: "[goalId+nodeKind+nodeId], goalId, nodeKind, nodeId, updatedAt"`；v11 已移除 `tasks` / `tracks` 的旧 `goalId` 索引。**当前库版本与完整 `stores()` 见 [data-model §10](data-model.md)**，这里的版本号只标该索引是哪一版引入的。`lib/goals.ts` 是本地写入边界：Goal CRUD、添加/移出成员、前置边更新、删除 Goal 和 goal 内快建 ToDo 都必须在 Dexie transaction 内写业务表与 `syncLog`。添加已有成员会先校验对应 Task/Track 当前存在；重复添加同一 typed ref 是 no-op。

普通同步和 Backup JSON 都必须保存完整 `Goal.members` 与 typed `prerequisites`。server sync 只强校验 Goal 自身结构，不做跨表存在性强校验，避免历史失效引用阻断同步。force-push 仍不包含 `goals` / `goal_layout_pins` payload，也不再从 tasks/tracks 携带目标归属；覆盖服务器时只应用五个覆盖域的差异，目标与布局钉点的业务行、tombstone 和 seq 均保持原样。

`goal_layout_pins` 是 Goal 图布局的独立 LWW 同步域，`countsInStatus:false`、priority 73。它只保存用户主动钉住的节点位置，不扩展 `Goal` schema，也不保存自动布局结果。业务身份是真复合键 `(goalId,nodeKind,nodeId)`；同步信封的 `recordId` 由 `encodeGoalLayoutPinKey(goalId,nodeKind,nodeId)` 生成，实体本身没有合成 `id` 字段。SQLite 使用 `PRIMARY KEY (goal_id,node_kind,node_id)`，Dexie 使用 `[goalId+nodeKind+nodeId]`。`nodeKind` 固定为 `goal | task | track`；`goal` 钉点是世界坐标，`task` / `track` 钉点是相对该 Goal 锚点的偏移。删除钉点表示恢复自动布局；未钉节点的位置由布局/仿真计算，不持久化。删除 Goal 与移出成员会在同一 Dexie 事务内级联回收对应钉点（`deleteGoal` 清该 Goal 全部 world/成员 pin，`removeGoalMember` 清该成员 pin），逐条写 `goal_layout_pins` delete `syncLog`，不留孤儿钉点。

## 3. Roll-up

`lib/goalsView.ts` 是纯函数层：

- `goalMembers` 按 `Goal.members` 数组顺序解引用 tasks / tracks / trackSteps。Task 完成取 `done`；Track 完成取 `status==="concluded"`。
- `splitGoalMembers` 分为「现在能推进」「在等前置」「已完成」：未完成且没有未完成 blocker 的成员进入 ready；等待未完成 blocker 的进入 blocked。
- `project` 进度是 `completed / total / ratio`。
- `momentum` 固定用 7 天窗口：统计近 7 天有活动的成员数和 `lastActivityAt`，Project / Theme 都会计算。Track 活跃时间取 track `updatedAt` 与 steps 时间中的最新值。
- 缺失成员不参与 ready/blocked/completed、Project total、Theme momentum；指向非有效成员的前置边忽略。

UI 复用三行主显：动量、前线、完成计数。`/goals` 列表项显示同一口径；Project 不显示百分号和进度条，只保留低对比总数。`/goals/:id` 是 Adaptive Goal Graph Editor，把 `buildGoalOverview` 转成局部图模型（壳层加载门与图语义见 [goals/canvas](goals/canvas.md#goals-canvas-s2)）。详情页内快建 ToDo 仍由 `addTaskForGoal` 在同一 Dexie transaction 内创建普通根 Task、append `{kind:"task",id}` 到 `Goal.members`，并写 `tasks/create` 与 `goals/update` 两条 `syncLog`；归档 Goal 不允许快建任务，但仍允许整理成员和前置关系。

<a id="goals-s4"></a>

## 4. 不做

- 不做互斥边、权重边、步骤级 roll-up。
- 不自动展开 `Track.refs`；只有显式写入 `Goal.members` 的 Task/Track 参与 roll-up。
- 不新增 agent 写 Goal 的端点；agent 仍通过受控 task / track API 写各自领域。

画布侧的“不做”（跨 Goal 依赖编辑、自由便签、多层目标 / 软顺序）见 [goals/canvas](goals/canvas.md#goals-canvas-s3)。

## 5. 模块速查

| 入口 | 职责 |
|---|---|
| `shared/src/entitySchemas.ts` | `GoalSchema`、`GoalMemberRefSchema`、typed `GoalPrerequisiteSchema` |
| `shared/src/goalLayoutPins.ts` | `goal_layout_pins` 复合 recordId encode/decode helper |
| `shared/src/syncDomains.ts` | `goals` 与 `goal_layout_pins` LWW 域登记 |
| `server/src/lib/goal-rows.ts` / `server/src/sync/domains.ts` | `goals.members` / `goals.prerequisites` row 映射与通用 LWW 注册 |
| `server/src/lib/goal-layout-pin-rows.ts` | `goal_layout_pins` snake_case row 映射 |
| `client/src/lib/goals.ts` | Goal CRUD、添加/移出成员、前置编辑、goal 内快建 ToDo |
| `client/src/lib/goalLayoutPins.ts` | Goal 图钉点 CRUD / 全量读取，写业务表与 `syncLog` |
| `client/src/lib/goalsView.ts` | `Goal.members` 解引用、ready/blocked/completed、project/theme roll-up、momentum |

画布纯函数（`goalGraph*` / `goalGalaxy*` / `galaxyEngineMode` / `goalUnassigned`）与 `pages/goals/**` 组件的速查在 [goals/canvas](goals/canvas.md#goals-canvas-s4)。
