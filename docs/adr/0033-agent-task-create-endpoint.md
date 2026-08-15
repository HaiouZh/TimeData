# 0033. agent 可经受控端点新建任务

- 日期：2026-08-15
- 状态：已接受
- 关系：延续 [0011](0011-server-api-as-write-boundary.md)

## 背景

在此之前 agent 对 tasks 只有一个封闭动作集合：`POST /api/agent/tasks/:id/status` 的
`done` / `note` / `tags`——只能改已有任务，建不了新任务。

实测显示待办的捕捉入口已经不在 TimeData 里：在电脑前干活时，想法与待办直接进了
ClaudeCode 会话再没回来。要把它们收回来，就需要一条 agent 能建任务的通道。

## 决策

新开 `POST /api/agent/tasks`，受 `scopedAuthMiddleware` 保护，行为对齐已长期运行的
`POST /api/quick-notes` agent 投递端点：strict zod → `requestId` 幂等 →
`applyChange()` + `sync_seq` + `notifySyncChange()`。

三条边界：

1. **只建 root task**。请求体不含 `parentId`，从接口形状上堵死一层父子约束被绕过的可能。
2. **调用方拥有语义时间**：`createdAt` 与 `completedAt` 可回填历史，同 agent-tracks 里
   「server 拥有记账、agent 拥有语义时间」的既有分工。`updatedAt` 与 `op.at` 仍由服务端分配。
3. **回填方向不对称**：向历史不设限（日终跑写的就是更早的时刻），向未来卡 5 分钟容差
   （防时钟漂移把未来时间写进账）。`completedAt < createdAt` 返回 400。

## 读边界（2026-08-16 补）

同一决策的另一面：日终提取要在补录前比对用户已有的待办，因此窄域 `AGENT_TOKEN` 获得了
第一份读权限 —— `GET /api/agent/tasks`。此前 `/api/agent/*` 全部是写端点。

不另开 ADR，因为它与本 ADR 是同一个问题的两面：agent 通道能碰 tasks 的哪些部分。

三条收窄，每条对应一种被滥用的可能：

1. **只返回 5 个字段**（`id` / `title` / `done` / `createdAt` / `completedAt`），不是完整 `Task`。
   去重只需要标题与时间，`tags` / `weight` / `sortOrder` 等一概不给。
2. **只返回根任务与非重复模板**。子任务与 recurrence 模板不参与去重，返回它们只是扩大暴露面。
3. **`completedSince` 卡 30 天上限**，超出返回 400。防止一个查询参数把全部历史读出去。

**不复用 `GET /api/tasks?kind=pool&done=0`** 的理由：它挂在 `authMiddleware` 下（只认全权限
`AUTH_TOKEN`）且返回完整 Task 全字段。让调用方配全权限 token 会让 `scopedAuthMiddleware`
失去存在意义 —— 那道中间件的全部理由就是「agent 只拿它需要的那点权限」。

## 后果

- tasks 因此有了**第四条 server 写入通道**（并列见 `evergreen/todo/invariants.md` 第 3 条）。
- 已完成事项可带真实 `completedAt` 直接入库，todo 表本身成为当日的账。
- **记账时刻与业务时刻分离**：`change.timestamp`、服务端分配的 `updated_at`、`op.at` 三者取记账时刻，
  `data.createdAt` / `data.completedAt` 才是业务时刻。参与 LWW 比较的是前两者；`op` 目前只有
  **存在性**被消费（决定服务端放不放行完成字段守卫列），`op.at` 尚无消费点，取记账时刻是为与前两者同源
  ——将来它若进入冲突判定，历史时间会让这条 create 被误判为陈旧写入。
  该约定当前**只有代码注释与本节在守，无测试承重**：把 `op.at` 改成回填值时 28 条用例全绿。
- 完成态字段组对齐客户端非重复路径：`lastDoneAt` 恒 `null`、`completedCount` 恒 `0`、
  `skipped` 恒 `false`。`completedCount` 全仓只有置 0 路径，写非零是脏数据。
- 未做：CLI 封装、批量端点。有需要再单独评估。
