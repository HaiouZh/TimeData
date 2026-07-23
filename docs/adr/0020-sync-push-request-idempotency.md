# 0020 push requestId 幂等与响应回放

日期：2026-07-23 ｜ 状态：已采纳

## 背景
弱网（实测丢包 20%+、单枪 15s 零重试）下引入请求对冲/快重试后，push 可能重放。
LWW+staleGuard 下重放能收敛，但会产生冗余 seq 推进与回声，且 outcomes 可能与首发不一致。

## 决策
- `SyncPushRequest` 增加可选 `requestId`（纯增量，旧服务器 zod 剥掉即回到现状，不升协议版本）。
- 服务端 `sync_push_requests` 表存 (requestId → status_code, 原响应 JSON)，同 id 重放原响应（200 与校验 409），不重复 apply、不产生新 seq；TTL 24h 惰性清理。
- 回放响应保留**首发时**的 latestSeq：期间若他人推进 seq，客户端 canSkipEchoPull 的无插队判定不成立，自动回落 pull，无游标跳跃风险。
- 备份竞态 409 与 500 不回放——客户端带同 id 重试时应真正重新执行。

## 后果
- push 对冲/重试安全；重放留 `push_replayed` 审计日志。
- 新增服务端表一张（infra 表，非同步域，不进登记簿）。
