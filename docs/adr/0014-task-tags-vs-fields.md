# ADR 0014：任务 tags 与结构化字段的边界

- 状态：已采纳（2026-06-16）
- 关联：延续 [ADR 0012](./0012-sync-ledger-and-domain-registry.md) 的任务 LWW 域；补充 [ADR 0013](./0013-capability-token-tiers.md) 的 agent 任务回写能力
- 设计来源：本地计划 `docs_local/plans/2026-06-16-todo-data-completedAt-tags-plan.md`

## 背景

任务域已经有 `done`、`turn`、`turnAt`、`recurrence`、`lastDoneAt`、`completedCount` 等结构化字段。外部 agent 还需要给任务打一些轻量语义标记，例如 `agent`、`idea`、`waiting-user`。这些标记目前只用于人查看、聚合筛选或 agent 自己表达语义，不需要系统可靠地按它们自动动作。

如果把所有新维度都设计成结构化字段，会让 schema、迁移、同步、UI 与 CLI 的成本过早增长；如果把所有维度都塞进自由标签，又会把 `turn` 这类承重信号放进无保证命名空间，破坏队列和回合语义。

## 决策

待办元数据分两类：

1. **结构化字段**：代码需要可靠地按它动作的信号，例如 `done`、`turn`、`turnAt`、`completedAt`、`recurrence`。这类字段走 additive schema/SQLite 迁移，并由 shared schema、同步域、server API 和客户端 helper 共同维护。
2. **自由 `tags`**：人或 agent 用来表达语义的字符串数组，用于展示、聚合筛选或人工阅读。`tags` 不驱动任何自动逻辑，不参与排期、完成、回合状态或同步冲突策略。

边界判据只有一个：**代码是否需要可靠地按它动作**。是，则做结构化字段；否，则先用 tag。

## 演进路径

新维度默认先作为 tag 试验，零迁移、零 UI 承诺。某个 tag 被证明需要代码可靠驱动后，再毕业成结构化字段：

1. 新增 additive 字段/列和 shared schema。
2. 保留旧 tag 作为历史语义，不要求破坏性清理。
3. 后续 UI 可以在展示层把结构化字段和 tags 统一当作可筛 facet，但存储层仍保持两类数据的边界。

## 不做

- 不做用户可配置字段定义系统。
- 不把 `turn` 并进 tags：`turn` 是单值互斥、驱动队列排序和 agent 回写的承重信号，需要枚举与时间戳保证。
- 不让 tags 驱动自动排期、完成、同步冲突或权限判断。

## 后果

- `Task` 新增 `tags: string[]` 与 `completedAt: string | null`。`completedAt` 是普通任务完成时间；重复任务仍使用 `lastDoneAt` / `completedCount` 表达完成进度。
- 授权 agent 可通过 `/api/agent/tasks/:id/status` 或 CLI `task-tag` 写入 tags；这仍是服务端受控 API 写入，不新增底层写入路径。
- 以后新增任务语义时，先判断它是否需要代码可靠动作；不要机械新增字段，也不要把承重信号塞进自由 tags。
