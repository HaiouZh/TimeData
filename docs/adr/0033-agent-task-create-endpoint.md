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

## 后果

- tasks 因此有了**第四条 server 写入通道**（并列见 `evergreen/todo/invariants.md` 第 3 条）。
- 已完成事项可带真实 `completedAt` 直接入库，todo 表本身成为当日的账。
- `op.at` 与 `data.completedAt` 刻意分离：前者是 LWW 记账时刻，后者是业务完成时刻。
  用历史时间做 `op.at` 会让这条 create 在跨设备比对时被误判为陈旧写入。
- 完成态字段组对齐客户端非重复路径：`lastDoneAt` 恒 `null`、`completedCount` 恒 `0`、
  `skipped` 恒 `false`。`completedCount` 全仓只有置 0 路径，写非零是脏数据。
- 未做：CLI 封装、批量端点。有需要再单独评估。
