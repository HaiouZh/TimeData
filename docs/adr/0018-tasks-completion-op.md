# 0018 tasks 完成语义用 op 授权写入

## 状态

已采纳（2026-07-04）

## 背景

P1 的 staleGuard 解决了冲突记录中过期来包覆盖新数据的问题，但仍保留一个高频漏洞：tasks 是 LWW 整行快照同步，设备 A 勾选任务后，设备 B 基于旧快照后发改标题或拖排序，payload 里携带旧的 `done=false`，服务端按整行覆盖会把 A 的勾选翻回。

这个问题不能靠服务端重算完成语义解决。重复任务、occurrence 子任务、跳过与撤勾推进都由客户端本地业务逻辑维护，服务端只负责权威校验、写入与账本，不理解“这一次勾选的是哪一发 occurrence”。

## 决策

1. shared 契约给 `tasks` upsert `SyncChange` 增加可选 `op`，形如 `{ type: "complete" | "reopen" | "skip" | "amend"; at: string }`；`SyncLogEntry` 同步保存这个可选字段。非 tasks 域来包带 `op` 仍由 zod strip，行为不变。
2. `op` 是授权标志，不是服务端重算指令。带 `op` 的 tasks upsert 仍按客户端快照写入完成字段；服务端只判断“这次是否被授权覆盖完成语义列”。
3. 客户端在 `putTask` 总闸读取 prev 行，用 `done` / `completedAt` / `skipped` / `lastDoneAt` / `completedCount` 的 diff 推导 `op`；少数绕开 `putTask` 的事务直写点手动传同一个 `completionOp(prev, next, at)`。改标题、改排序、改标签、改权重等非完成语义写入不附 `op`。
4. `compactSyncLogs` 对同一记录压缩时保留时间序最后一条带 `op` 的日志。完成后又改标题的组，最终 change 的 timestamp 取最后一条日志，`op` 取组内最后一次完成语义意图，避免快照 done=true 失去授权。
5. server LWW 映射增加通用 `guardedColumns`。`tasks` 配置 `done`、`completed_at`、`skipped`、`last_done_at`、`completed_count` 为守卫列；无 `op` 的 upsert 撞现存行时，这些列不进入 `ON CONFLICT DO UPDATE SET`。

## 后果

- 设备 A 勾选、设备 B 后发改标题/拖排序时，B 的无 `op` 快照不能再翻回 A 的完成态；标题和排序等非守卫列仍照常 LWW 合并。
- create 撞现存行也遵循同一规则：镜像子任务等确定性 id 场景必须由新客户端附 `op` 才能覆盖完成字段；行不存在时 create 仍全列写入。
- 旧客户端 + 新服务端：旧客户端自己的勾选不带 `op`，撞现存行时无法写完成字段；但旧客户端也不能再误翻新客户端的勾选。运维部署顺序应先客户端（Web + APK）后服务端。
- 新客户端 + 旧服务端：旧 shared zod 会剥离 `op`，服务端继续旧整行覆盖语义，不比现状更差；完成语义保护在服务端升级后生效。
- 未来若其他 LWW 域也需要“意图字段”保护，可复用 `guardedColumns` 机制，但每个域的 `op` 契约仍应单独设计，避免把服务端变成业务语义重算器。
