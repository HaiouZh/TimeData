# ADR 0038：安卓同步请求走 WebView + 原生双车道，push 也以原生作备份

- 状态：已采纳（2026-10-13）
- 关联：修订 evergreen [sync](../evergreen/sync.md#sync-overall-flow) 中「原生通道只承载 resume 的 status / 增量 pull、写请求不走原生」的范围约定；push 重复到达的兜底依赖 [ADR 0020](0020-sync-push-request-idempotency.md) 的 `requestId` 回放

## 决策

1. 安卓壳（`CapacitorHttp` 可用）上，普通同步的 `GET /api/sync/status`、增量 `POST /api/sync/pull`、`POST /api/sync/push` 一律带**另一条车道作备份**（`apiFetch` 的 `laneBackup`）：主路网络失败立即、`SYNC_LANE_BACKUP_DELAY_MS`（2 s）内没回也发，先回者胜。
2. 主路规则不变：resume 的 status / 增量 pull 以原生为主路、WebView 作备份；其余原因与全部 push 以 WebView 为主路、原生作备份。
3. **带 TOTP 头的 push 不走原生备份**，保持单路 WebView 同源对冲。
4. `sinceSeq: 0` 全量拉取、force-push、健康诊断、管理 API、SSE 仍是单路 WebView；iOS / 桌面 / PWA 的请求参数不变。

## 理由

- **同源对冲换不了连接**：WebView 把同源请求都挤在一条 HTTP/2 连接上。2026-10-13 晚，安卓一次 push 的两枪发出时相隔 1.5 s，到达服务器时只相隔 21 ms，之前都卡了约 10 s——两枪被同一条连接堵住、又一起放行。同一时刻原生通道的 pull 3 ms 正常通过。当晚 6 次同步每次卡满 15 s 超时，服务器对收到的每个请求都在毫秒级答完。
- **两条车道各有卡住的时候**：2026-10-10 是原生卡住、WebView 通（那次只给读请求配了 WebView 备份）；2026-10-13 是 WebView 卡住、原生通。备份只有走另一个连接池才有意义，所以方向做成对称的。
- **push 走原生是安全的**：每批 push 自带 `requestId`，服务端同 id 的后到请求直接回放首次响应，不重复落库、不产生新 seq（ADR 0020）。原生请求取消不了，输家可能晚到很久，只要还在 1 天的回放窗口里就只会命中回放。当晚那次 push 的第二枪正是命中回放（`push_replayed`）。
- **TOTP push 例外**：带 TOTP 头的是大批删除，服务端走「先建安全备份」路径。那里有 `await` 窗口，且该路径不写回放表，晚到的重复请求可能被判 409 要求重试。原生输家取消不了、晚到更久，所以这类请求不扩大暴露面。
- **延迟取 2 s**：近 30 天安卓有动作的同步轮 pull / push p95 约 1.9 s，正常轮约 5% 会触发备份。备份请求在服务端是毫秒级的开销。

## 后果

- 只有一条车道卡住时，同步在「2 s + 一个往返」内完成；**两条同时卡**（线路级拥堵，当晚出现过一次）仍要等 15 s 总时限。同一晚走代理（Hysteria2 / VLESS）的 iPhone 没有出现卡顿，线路级改进另议。
- 正常轮约 5% 会多发一个请求；原生输家完成后服务端多一条 `pull_returned` 或 `push_replayed` 审计行。
- 观测：每轮按 `lanes { backupFired, backupWon }` 计数，写进本机计时、`sync_error` 与 `sync_recovered`；成功轮里只要第二车道救回过请求，就另攒一条 `sync_lane_rescue`（10 分钟节流）。读法见 [sync/troubleshooting](../evergreen/sync/troubleshooting.md)。
