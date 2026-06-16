# ADR 0013：能力令牌分层（master token + agent token）

- 状态：已采纳（2026-06-16）
- 关联：延续 [ADR 0011](./0011-server-api-as-write-boundary.md)；提前落地本地路线图 3.3 的“封闭动作”安全模型
- 设计来源：本地 spec `docs_local/specs/2026-06-16-todo-turn-attention-queue-design.md`

## 背景

TimeData 原先只有一个 `AUTH_TOKEN`，所有受保护 `/api/*` 都用同一 Bearer Token。这个模型对用户设备、CLI 和完整管理入口足够简单，但外部 agent 只需要做少量预定义动作：查任务、把任务状态交回、附一条结果备注。把全权 token 交给长期运行的 agent 会把泄露影响面扩大到 sync、force-push、admin、export 等高风险入口。

## 决策

引入两层能力令牌：

1. `AUTH_TOKEN` 是 master token，现有行为不变，继续保护普通 `/api/*`、sync、admin、export、data reset、自更新等全权入口。
2. `AGENT_TOKEN` 是窄域 token，只被 `/api/agent/*` 作用域中间件接受。当前唯一写接口是 `POST /api/agent/tasks/:id/status`，允许设置任务 `turn`、设置 `done=true`、追加一条结果备注子任务。
3. `/api/agent/*` 在 `packages/server/src/index.ts` 中注册在全局 `/api/*` master auth 之前，单独挂 `scopedAuthMiddleware`；其余路由仍只认 `AUTH_TOKEN`。
4. `scopedAuthMiddleware` 接受 master token 或 agent token 任一匹配；两者都缺失时保持 fail-closed，只有显式 `ALLOW_UNAUTHENTICATED_DEV=1` 才在本地开发放行。

## 理由

- 单人自托管场景不需要 RBAC 或按任务短时授权；需要的是把 agent 泄露影响面限制在“预定义任务状态回写”。
- agent token 泄露后最多能翻转任务回合状态、把任务标为完成、追加备注；不能 force-push、导出数据、读 admin 洞察、重置数据或触发自更新。
- master token 行为完全兼容，现有 Web、CLI 和移动端不用迁移。

## 后果

- 部署可选配置 `AGENT_TOKEN`。未设置时，`/api/agent/*` 仍可用 master token 调用；设置后可把 agent token 单独交给外部 agent。
- CLI 新增 `task-running` / `task-handback` / `task-park` / `task-done`，它们仍只是 server API 客户端，不新增底层写入路径。
- 新增 agent 受控动作必须继续挂在 `/api/agent/*`，并确认 agent token 泄露影响面仍是封闭、可接受的预定义动作集合。
