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
  - packages/client/src/pages/goals/**
last-reviewed: 2026-06-22
---

# 目标层

> Goal 是轻量目标层：把 Task 点和 Track 线收编到一个目标下，看项目完成度、主题近期活跃度和成员前置关系。它不是全局依赖图，也不替代 todo / tracks 自身语义。

## 承上启下

- **上游**：用户在 `/goals` 新建 `project` / `theme`，在 `/goals/:id` 编辑标题、备注、状态、成员和前置关系。
- **下游**：Web 写入 Dexie 业务表并同事务写 `syncLog` → [sync](sync.md) 的 `goals` LWW 域 → server SQLite `goals` 表 → 其他设备按 `sync_seq` pull。
- **契约**：`Goal` schema、`Task.goalId`、`Track.goalId` 在 shared；跨表映射见 [data-model](data-model.md)；完整备份见 [backup](backup.md)。
- **邻居**：[todo](todo.md) 的 `done` / 重复规则和 [tracks](tracks.md) 的 `status` / steps 都保持原语义，Goal 只做归属、展示和前置边解释。

## 1. Schema

`Goal`：

```ts
{
  id: string;
  title: string;
  kind: "project" | "theme";
  status: "active" | "archived";
  note?: string;
  prerequisites: Array<{ blocker: string; blocked: string }>;
  createdAt: string;
  updatedAt: string;
}
```

成员归属存在成员侧：`Task.goalId: string | null`、`Track.goalId: string | null`。一个 Task / Track 同时只能属于一个 Goal；删除 Goal 会清空这些成员的 `goalId`，不会删除任务或轨道。

`prerequisites` 是目标内部成员之间的有向边：`blocker` 必须先完成，`blocked` 才算可推进。shared schema 拒绝自环、重复边和环；UI roll-up 会忽略指向非当前成员的边并保留提示。

## 2. 存储与同步

`goals` 是一等同步域，`conflictPolicy:"lww"`、`countsInStatus:false`、priority 72。服务端走通用 LWW，SQLite `goals.prerequisites` 存 JSON 字符串；`tasks.goal_id` / `tracks.goal_id` 是普通 TEXT 列和索引，不建外键。

客户端 Dexie v10 增加 `goals: "id, kind, status, updatedAt"`，并给 `tasks` / `tracks` 增加 `goalId` 索引。`lib/goals.ts` 是本地写入边界：Goal CRUD、成员归属、前置边更新和删除清成员都必须在 Dexie transaction 内写业务表与 `syncLog`。

force-push 不新增 `goals` payload；当前只保留 `tasks.goalId` 随 tasks 核心 payload 写入服务器。Goal 完整数据走普通增量同步与 Backup JSON。

## 3. Roll-up

`lib/goalsView.ts` 是纯函数层：

- `goalMembers` 从 tasks / tracks / trackSteps 聚合成员。Task 完成取 `done`；Track 完成取 `status==="concluded"`。
- `splitGoalMembers` 分为「现在能推进」「在等前置」「已完成」：未完成且没有未完成 blocker 的成员进入 ready；等待未完成 blocker 的进入 blocked。
- `project` 进度是 `completed / total / ratio`。
- `theme` 进度固定用 7 天窗口：统计近 7 天有活动的成员数、总成员数和 `lastActivityAt`。Track 活跃时间取 track `updatedAt` 与 steps 时间中的最新值。

UI 只呈现纯文本列表和详情：`/goals` 列表显示项目完成度或主题「近7天」活跃度；`/goals/:id` 显示成员分区、前置关系编辑、成员添加/移出和删除目标确认。

## 4. 不做

- 不做画布、全局依赖图、多层目标或软顺序。
- 不做一个成员归属多个目标。
- 不做互斥边、权重边、步骤级 roll-up。
- 不新增 agent 写 Goal 的端点；agent 仍通过受控 task / track API 写各自领域。

## 5. 模块速查

| 入口 | 职责 |
|---|---|
| `shared/src/entitySchemas.ts` | `GoalSchema`、`Task.goalId`、`Track.goalId` |
| `shared/src/syncDomains.ts` | `goals` LWW 域登记 |
| `server/src/lib/goal-rows.ts` / `server/src/sync/domains.ts` | SQLite row 映射与通用 LWW 注册 |
| `client/src/lib/goals.ts` | Goal CRUD、成员归属、删除清成员 |
| `client/src/lib/goalsView.ts` | 成员聚合、ready/blocked/completed、project/theme roll-up |
| `client/src/pages/goals/**` | 列表、详情、成员选择、前置编辑 |

**测试**：`shared/src/{entitySchemas,schemas,syncDomains}.test.ts`、`server/src/sync/goals-domain.e2e.test.ts`、`client/src/lib/{goals,goalsView}.test.ts`、`client/src/pages/goals/*.test.tsx`。
