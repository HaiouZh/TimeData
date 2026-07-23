# 0021 SSE bump 携带增量数据

日期：2026-07-23 ｜ 状态：已采纳

## 背景
前台 SSE 通知通道（见 [`sync.md`](../evergreen/sync.md) §1.5）广播的 `event: bump` 此前只含 `{ latestSeq }`：任意写路径推进账本后，所有在线设备收到通知，但只知道"号变了"，仍要自己发一轮 `/api/sync/pull` 才能拿到真正的业务数据。多设备热同步场景下（比如手机刚写完一条，桌面端几乎同时收到 bump），这个"通知 + 再拉一次"的往返在弱网（详见 [ADR 0020](./0020-sync-push-request-idempotency.md) 背景）下是额外一整段延迟；而 push 端点在响应客户端自己之前，早已在同一次请求里把 `(fromSeq, latestSeq]` 区间的 changes 算好在手上——只是没有搭车带给其他监听 SSE 的设备。

## 决策
- **仅 `/api/sync/push` 构造带数据的 bump**：`notifySyncChange(latestSeq, payload?)` 新增可选 `payload: { fromSeq, changes }`；push 成功 apply 后，用 `buildBumpPayload(db, latestSeqBefore, latestSeqAfter)` 读出本次 push 造成的 `(fromSeq, latestSeqAfter]` 区间 changes 一并广播。除 push 外的写路径（force-push、agent 写入等）继续只传 `latestSeq`，`notifySyncChange` 退化为纯 bump——不放大改动面。
- **上限即退化，不做分片**：`BUMP_MAX_CHANGES = 50` 条、`BUMP_MAX_BYTES = 32 * 1024` 字节（序列化后），任一超限直接放弃 `payload`、退化为纯 `{ latestSeq }`。SSE 是通知通道不是搬运通道；超限场景本就少见（单次 push 极少超过 50 条），退化后收端走现状的 pull 补齐，不引入分片/续传复杂度。
- **契约纯增量、旧新互不知**：`SyncStreamBumpSchema`（`packages/shared/src/schemas.ts`）定义 `{ latestSeq, fromSeq?, changes? }`；旧客户端只读 `latestSeq`，新字段对它透明。客户端 `SyncContext` 解析 SSE 消息时用该 schema 校验，`safeParse` 失败（畸形/旧协议）一律退化为纯 bump 处理，不丢事件、不抛错。
- **客户端单槽 stash + 游标连续才就地 apply**：`engine.ts` 暴露 `stashBumpPayload`/`clearBumpStash`，`SyncContext` 收到带 `fromSeq`+`changes` 的 bump 就存入模块级单槽（新覆盖旧，不排队）。仅当 `regularSync()` 判定本地无 pending（`unsyncedCount === 0`）且 `stash.fromSeq === 本地游标` 时，才在零网络下直接调用与 pull 共用的 `applyPullChangesBatch` 就地写入、游标推进到 `stash.latestSeq`。无 pending 分支内 `stash` 一律无条件取出即清（`takeBumpStash`）：不匹配、apply 抛错都自然退化为现状的 status 预查 + pull 链路；有 pending 的那一轮走写后 push 路径、stash 原地排队（不取不清）等下一轮无 pending 再判定——各分支均不产生游标跳跃或数据丢失风险。

## 后果
- 跨设备热同步在无插队场景下免去 pull 往返：另一设备写完 → 本设备收到 SSE → 直接落库，全程零额外请求（比对：之前是"收到 bump → 发 pull → 落库"）。
- SSE 单条消息体量上限抬到 ~32KB（此前只有几十字节的 `{latestSeq}`），仍远低于常见反向代理/浏览器的 SSE 单帧限制，属可接受量级。
- 新旧版本互操作 = 现状：旧服务端不发 `payload`、旧客户端不解析 `payload`，两端任一为旧版本都自动回落到"纯 bump 通知 + pull 补齐"，无需强制同版本升级（不同于 [ADR 0012](./0012-sync-ledger-and-domain-registry.md) 里 `sinceSeq` 那类破坏性收窄）。
