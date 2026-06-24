---
type: evergreen
title: 目标层
covers:
  - packages/shared/src/entitySchemas.ts
  - packages/shared/src/syncDomains.ts
  - packages/server/src/lib/goal-rows.ts
  - packages/server/src/sync/domains.ts
  - packages/client/src/lib/goals.ts
  - packages/client/src/lib/goalsView.ts
  - packages/client/src/lib/goalGraphModel.ts
  - packages/client/src/lib/goalGraphEdges.ts
  - packages/client/src/lib/goalGraphLayout.ts
  - packages/client/src/lib/goalGraphViewport.ts
  - packages/client/src/lib/goalGraphLod.ts
  - packages/client/src/pages/goals/**
last-reviewed: 2026-06-23
---

# 目标层

> Goal 是轻量目标层：把 Task 点和 Track 线收编到一个目标下，看项目完成度、主题近期活跃度和成员前置关系。它不是全局依赖图，也不替代 todo / tracks 自身语义。

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

成员关系存在 Goal 侧：`Goal.members` 是 typed 引用集合，成员只允许 `task` / `track`。同一个 Task / Track 可以被多个 Goal 引用；删除 Goal 只删除 Goal，不改 Task/Track。

`prerequisites` 是目标内部成员之间的 typed 有向边：`blocker` 必须先完成，`blocked` 才算可推进。shared schema 拒绝重复成员、前置边引用非成员、自环、重复边和环；UI roll-up 对历史坏数据仍宽容，会忽略缺失成员和指向非有效成员的前置边并保留低调提示。

## 2. 存储与同步

`goals` 是一等同步域，`conflictPolicy:"lww"`、`countsInStatus:false`、priority 72。服务端走通用 LWW，SQLite `goals.members` 与 `goals.prerequisites` 都存 JSON 字符串；`tasks` / `tracks` 不再有 `goal_id` 归属列，新库不建，旧库启动时幂等 drop。

客户端 Dexie v11 保留 `goals: "id, kind, status, updatedAt"`，并移除 `tasks` / `tracks` 的旧 `goalId` 索引。`lib/goals.ts` 是本地写入边界：Goal CRUD、添加/移出成员、前置边更新、删除 Goal 和 goal 内快建 ToDo 都必须在 Dexie transaction 内写业务表与 `syncLog`。添加已有成员会先校验对应 Task/Track 当前存在；重复添加同一 typed ref 是 no-op。

普通同步和 Backup JSON 都必须保存完整 `Goal.members` 与 typed `prerequisites`。server sync 只强校验 Goal 自身结构，不做跨表存在性强校验，避免历史失效引用阻断同步。force-push 仍不包含 `goals` payload，也不再从 tasks/tracks 携带目标归属。

## 3. Roll-up

`lib/goalsView.ts` 是纯函数层：

- `goalMembers` 按 `Goal.members` 数组顺序解引用 tasks / tracks / trackSteps。Task 完成取 `done`；Track 完成取 `status==="concluded"`。
- `splitGoalMembers` 分为「现在能推进」「在等前置」「已完成」：未完成且没有未完成 blocker 的成员进入 ready；等待未完成 blocker 的进入 blocked。
- `project` 进度是 `completed / total / ratio`。
- `momentum` 固定用 7 天窗口：统计近 7 天有活动的成员数和 `lastActivityAt`，Project / Theme 都会计算。Track 活跃时间取 track `updatedAt` 与 steps 时间中的最新值。
- 缺失成员不参与 ready/blocked/completed、Project total、Theme momentum；指向非有效成员的前置边忽略。

UI 复用三行主显：动量、前线、完成计数。`/goals` 列表项显示同一口径；Project 不显示百分号和进度条，只保留低对比总数。`/goals/:id` 是 Adaptive Goal Graph Editor：壳层用 live query 读取 Goal、Task、Track、TrackStep，编辑器把 `buildGoalOverview` 转成局部图模型并显示 Goal 锚、真实 Task/Track 节点和 ghost 失效引用。详情页内快建 ToDo 仍由 `addTaskForGoal` 在同一 Dexie transaction 内创建普通根 Task、append `{kind:"task",id}` 到 `Goal.members`，并写 `tasks/create` 与 `goals/update` 两条 `syncLog`；归档 Goal 不允许快建任务，但仍允许整理成员和前置关系。

## 4. 局部星图编辑器

`/goals/:id` 默认进入局部图编辑器，不保留 Phase 1 文字详情 fallback。图节点只表达 Goal 锚、真实 Task/Track 成员和 ghost 失效引用；前置边方向固定为 `blocker -> blocked`，Goal 锚和 ghost 不参与新建前置边。归属 tether 只表示成员属于 Goal，不作为可编辑前置关系。

图布局由 `goalGraphLayout` 纯计算：有前置依赖的成员进入 dependency lane，宽屏横向、窄屏纵向；无依赖成员进入围绕 Goal 的 orbit。布局按节点展示尺寸估算安全间距，dependency lane 与 orbit 都不能让节点、标题或连接把手互相重叠。React Flow 坐标按节点中心解释；`fitView` 只负责初次无本地 viewport 时把已展开的图放进视野，不作为解决重叠的手段。坐标不写入 Goal，只按 Goal id 在本地保存 pan/zoom 视口，且不参与同步。新增或删除前置边时节点可能在 orbit 与 lane 间切换，编辑器只做 transform 过渡；`prefers-reduced-motion` 下关闭这类动效。

交互语义以防误触为先：点节点只选中，显式“打开”才进入源页面。打开 Task 使用 `/todo?taskId=<id>` 深链；打开 Track 使用 `/tracks/:id`。Task 可在图内快速完成/取消完成，Track 状态仍回轨道页处理。结构写入仍只经 `lib/goals.ts` 和 Task 写入 helper：加已有成员、移出成员、快建任务、增删前置、编辑/归档/删除 Goal 都复用既有 Dexie + `syncLog` 边界。

图上浮层默认不拦截画布手势，但工具栏自身必须恢复可点击命中；“添加成员 / 回到全图 / 目标菜单”都属于图编辑器的主操作入口，不能被画布 pass-through 容器吞掉。

宽屏下，添加成员与目标设置使用星图局部右侧面板；窄屏/粗指针继续使用底部 sheet。添加成员面板复用 ToDo 的搜索和标签筛选口径，任务按今天/收件箱/已排期/重复/已完成分组，轨道按 active / parked / concluded 分组并显示看板信号和最新步骤提示。

轻撤销只覆盖破坏性结构操作：删除前置边、移出成员、移出失效引用。移出成员的撤销会恢复成员列表和被级联删除的前置边；Task 完成、加成员、快建任务、新建前置等非破坏操作不进入这条 undo 口径。

## 5. 不做

- 不做跨 Goal 全局依赖图或成员反向索引表。
- 不做自由便签、多层目标或软顺序。
- 不做互斥边、权重边、步骤级 roll-up。
- 不自动展开 `Track.refs`；只有显式写入 `Goal.members` 的 Task/Track 参与 roll-up。
- 不新增 agent 写 Goal 的端点；agent 仍通过受控 task / track API 写各自领域。

## 6. 模块速查

| 入口 | 职责 |
|---|---|
| `shared/src/entitySchemas.ts` | `GoalSchema`、`GoalMemberRefSchema`、typed `GoalPrerequisiteSchema` |
| `shared/src/syncDomains.ts` | `goals` LWW 域登记 |
| `server/src/lib/goal-rows.ts` / `server/src/sync/domains.ts` | `goals.members` / `goals.prerequisites` row 映射与通用 LWW 注册 |
| `client/src/lib/goals.ts` | Goal CRUD、添加/移出成员、前置编辑、goal 内快建 ToDo |
| `client/src/lib/goalsView.ts` | `Goal.members` 解引用、ready/blocked/completed、project/theme roll-up、momentum |
| `client/src/lib/goalGraphModel.ts` | `GoalOverview` → Goal 锚、真实节点、ghost 节点、tether / 前置边模型 |
| `client/src/lib/goalGraphEdges.ts` | 前置边自环、重复、环、Goal 锚、非成员校验与增删纯函数 |
| `client/src/lib/goalGraphLayout.ts` | dependency lane + orbit 自动布局，不持久化坐标 |
| `client/src/lib/goalGraphViewport.ts` | 按 Goal id 保存本地 pan/zoom 视口，不同步 |
| `client/src/lib/goalGraphLod.ts` | zoom → near/far 两档显示密度 |
| `client/src/pages/goals/GoalDetailPage.tsx` | live-query 壳，给图编辑器提供 Goal/Task/Track/Step 快照与导航回调 |
| `client/src/pages/goals/GoalGraphEditor.tsx` | Adaptive Goal Graph Editor：选中、动作分发、写入 helper 接线、轻撤销 |
| `client/src/pages/goals/**` | 目标列表、图节点/边、工具栏、添加成员 picker、宽屏右侧面板、Goal 编辑 sheet、撤销 toast |

**测试**：`shared/src/{entitySchemas,schemas,syncDomains}.test.ts`、`server/src/sync/goals-domain.e2e.test.ts`、`client/src/lib/{goals,goalsView,goalGraph*}.test.ts`、`client/src/pages/goals/*.test.tsx`。
